//! Per-workdir watcher: a recursive `notify` watcher whose raw events are
//! debounced (250ms window) and classified into workspace activity, with a 2s
//! mtime-sampling fallback when the native watcher cannot be created.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Weak};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use super::WorkspaceWatchService;

const DEBOUNCE_WINDOW: Duration = Duration::from_millis(250);
const POLL_INTERVAL: Duration = Duration::from_secs(2);
const POLL_STOP_CHECK: Duration = Duration::from_millis(250);
const MAX_CHANGED_PATHS: usize = 64;

/// Keeps one workdir watch alive. Dropping the handle stops it: the native
/// watcher teardown disconnects the aggregator channel, and the polling
/// fallback observes the stop flag.
pub(super) struct WorkdirWatcherHandle {
    _watcher: Option<RecommendedWatcher>,
    stop: Arc<AtomicBool>,
}

impl Drop for WorkdirWatcherHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

pub(super) fn spawn_workdir_watcher(
    workdir: String,
    service: Weak<WorkspaceWatchService>,
) -> WorkdirWatcherHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();

    let watcher = RecommendedWatcher::new(tx, Config::default()).and_then(|mut watcher| {
        watcher
            .watch(Path::new(&workdir), RecursiveMode::Recursive)
            .map(|_| watcher)
    });

    match watcher {
        Ok(watcher) => {
            let thread_workdir = workdir.clone();
            let spawned = thread::Builder::new()
                .name("workspace-watch".to_string())
                .spawn(move || run_aggregator(thread_workdir, rx, service));
            if let Err(error) = spawned {
                eprintln!("spawn workspace watch aggregator for {workdir} failed: {error}");
            }
            WorkdirWatcherHandle {
                _watcher: Some(watcher),
                stop,
            }
        }
        Err(error) => {
            eprintln!(
                "workspace watcher for {workdir} failed ({error}); falling back to 2s sampling"
            );
            let poll_stop = Arc::clone(&stop);
            let spawned = thread::Builder::new()
                .name("workspace-watch-poll".to_string())
                .spawn(move || run_poll_fallback(workdir, poll_stop, service));
            if let Err(error) = spawned {
                eprintln!("spawn workspace watch poll fallback failed: {error}");
            }
            WorkdirWatcherHandle {
                _watcher: None,
                stop,
            }
        }
    }
}

// ---- notify event aggregation ----

#[derive(Default)]
struct ActivityBatch {
    fs: bool,
    git: bool,
    changed: BTreeSet<String>,
    truncated: bool,
}

impl ActivityBatch {
    fn is_empty(&self) -> bool {
        !self.fs && !self.git
    }

    fn note_path(&mut self, rel: String) {
        if self.changed.contains(&rel) {
            return;
        }
        if self.changed.len() >= MAX_CHANGED_PATHS {
            self.truncated = true;
            return;
        }
        self.changed.insert(rel);
    }

    fn absorb(&mut self, workdir: &Path, canonical_workdir: Option<&Path>, event: notify::Result<Event>) {
        let event = match event {
            Ok(event) => event,
            Err(_) => {
                // Watcher-reported error (e.g. queue overflow): events may have
                // been lost, so the whole workdir must be considered dirty.
                self.fs = true;
                self.git = true;
                self.truncated = true;
                return;
            }
        };
        // Pure access notifications carry no state change.
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        for path in &event.paths {
            match relativize(workdir, canonical_workdir, path) {
                Some(rel) => match classify_rel_path(&rel) {
                    PathClass::Worktree => {
                        self.fs = true;
                        self.git = true;
                        self.note_path(rel);
                    }
                    PathClass::GitMeta => {
                        self.git = true;
                        self.note_path(rel);
                    }
                    PathClass::Ignored => {}
                },
                None => {
                    // Cannot attribute the path: err on the dirty side.
                    self.fs = true;
                    self.git = true;
                    self.truncated = true;
                }
            }
        }
    }
}

fn run_aggregator(
    workdir: String,
    rx: Receiver<notify::Result<Event>>,
    service: Weak<WorkspaceWatchService>,
) {
    let workdir_path = PathBuf::from(&workdir);
    // Some backends (e.g. FSEvents behind a symlinked prefix) report resolved
    // paths; keep the canonical form as an alternate strip prefix.
    let canonical = std::fs::canonicalize(&workdir_path).ok();
    let canonical = canonical.filter(|resolved| resolved != &workdir_path);

    loop {
        // Block for the first event of a burst, then keep absorbing until the
        // debounce window closes.
        let first = match rx.recv() {
            Ok(event) => event,
            Err(_) => return,
        };
        let mut batch = ActivityBatch::default();
        batch.absorb(&workdir_path, canonical.as_deref(), first);
        let window_end = Instant::now() + DEBOUNCE_WINDOW;
        let mut disconnected = false;
        loop {
            let now = Instant::now();
            if now >= window_end {
                break;
            }
            match rx.recv_timeout(window_end - now) {
                Ok(event) => batch.absorb(&workdir_path, canonical.as_deref(), event),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => {
                    disconnected = true;
                    break;
                }
            }
        }
        if !flush_batch(&service, &workdir, batch) || disconnected {
            return;
        }
    }
}

/// Emits a non-empty batch. Returns false when the service is gone and the
/// aggregator should stop.
fn flush_batch(service: &Weak<WorkspaceWatchService>, workdir: &str, batch: ActivityBatch) -> bool {
    if batch.is_empty() {
        return true;
    }
    let Some(service) = service.upgrade() else {
        return false;
    };
    service.emit_activity(
        workdir,
        batch.fs,
        batch.git,
        batch.changed.into_iter().collect(),
        batch.truncated,
    );
    true
}

fn relativize(workdir: &Path, canonical_workdir: Option<&Path>, path: &Path) -> Option<String> {
    let rel = path
        .strip_prefix(workdir)
        .ok()
        .or_else(|| canonical_workdir.and_then(|prefix| path.strip_prefix(prefix).ok()))?;
    let rel = rel.to_string_lossy().replace('\\', "/");
    if rel.is_empty() {
        return None;
    }
    Some(rel)
}

pub(super) enum PathClass {
    /// Working-tree change: invalidates both file views and git status.
    Worktree,
    /// Git bookkeeping change (HEAD, refs, index, ...): invalidates git only.
    GitMeta,
    /// Git internals (objects, locks, ...): dropped.
    Ignored,
}

pub(super) fn classify_rel_path(rel: &str) -> PathClass {
    let Some(inner) = rel.strip_prefix(".git/") else {
        if rel == ".git" {
            return PathClass::Ignored;
        }
        return PathClass::Worktree;
    };
    const GIT_META_FILES: &[&str] = &[
        "HEAD",
        "index",
        "packed-refs",
        "MERGE_HEAD",
        "ORIG_HEAD",
        "COMMIT_EDITMSG",
    ];
    if GIT_META_FILES.contains(&inner) || inner == "refs" || inner.starts_with("refs/") {
        PathClass::GitMeta
    } else {
        PathClass::Ignored
    }
}

// ---- polling fallback ----

#[derive(PartialEq, Eq)]
struct PollSample {
    workdir_mtime: Option<SystemTime>,
    head_mtime: Option<SystemTime>,
    index_mtime: Option<SystemTime>,
}

fn sample_workdir(workdir: &Path) -> PollSample {
    PollSample {
        workdir_mtime: mtime_of(workdir),
        head_mtime: mtime_of(&workdir.join(".git").join("HEAD")),
        index_mtime: mtime_of(&workdir.join(".git").join("index")),
    }
}

fn mtime_of(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).ok().and_then(|meta| meta.modified().ok())
}

fn run_poll_fallback(workdir: String, stop: Arc<AtomicBool>, service: Weak<WorkspaceWatchService>) {
    let workdir_path = PathBuf::from(&workdir);
    let mut last = sample_workdir(&workdir_path);
    loop {
        // Sleep the poll interval in short slices so a dropped handle stops
        // the thread promptly.
        let interval_end = Instant::now() + POLL_INTERVAL;
        while Instant::now() < interval_end {
            if stop.load(Ordering::Relaxed) {
                return;
            }
            thread::sleep(POLL_STOP_CHECK);
        }
        if stop.load(Ordering::Relaxed) {
            return;
        }
        let Some(service) = service.upgrade() else {
            return;
        };

        let current = sample_workdir(&workdir_path);
        if current == last {
            continue;
        }
        let fs_changed = current.workdir_mtime != last.workdir_mtime;
        let head_changed = current.head_mtime != last.head_mtime;
        let index_changed = current.index_mtime != last.index_mtime;
        let mut changed_paths = Vec::new();
        if head_changed {
            changed_paths.push(".git/HEAD".to_string());
        }
        if index_changed {
            changed_paths.push(".git/index".to_string());
        }
        service.emit_activity(
            &workdir,
            fs_changed,
            fs_changed || head_changed || index_changed,
            changed_paths,
            // Sampling cannot enumerate worktree paths.
            fs_changed,
        );
        last = current;
    }
}

#[cfg(test)]
mod tests {
    use super::{classify_rel_path, PathClass};

    #[test]
    fn classify_rel_path_routes_worktree_git_meta_and_ignored() {
        for rel in ["src/main.rs", "README.md", "a/b/c.txt", ".gitignore"] {
            assert!(matches!(classify_rel_path(rel), PathClass::Worktree), "{rel}");
        }
        for rel in [
            ".git/HEAD",
            ".git/index",
            ".git/packed-refs",
            ".git/MERGE_HEAD",
            ".git/ORIG_HEAD",
            ".git/COMMIT_EDITMSG",
            ".git/refs",
            ".git/refs/heads/main",
            ".git/refs/remotes/origin/main",
        ] {
            assert!(matches!(classify_rel_path(rel), PathClass::GitMeta), "{rel}");
        }
        for rel in [
            ".git",
            ".git/objects/ab/cdef",
            ".git/index.lock",
            ".git/HEAD.lock",
            ".git/FETCH_HEAD",
            ".git/logs/HEAD",
            ".git/refs-backup/x",
        ] {
            assert!(matches!(classify_rel_path(rel), PathClass::Ignored), "{rel}");
        }
    }
}
