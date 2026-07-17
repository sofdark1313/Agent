use serde_json::json;

use super::db;
use super::store::AutomationStore;
use super::types::*;
use super::validate::validate_cron_expression;

fn apply_input(base_revision: u64, ops: Vec<AutomationOp>) -> AutomationApplyInput {
    AutomationApplyInput { base_revision, ops }
}

fn create_bash_task_op(id: &str, name: &str) -> AutomationOp {
    AutomationOp::Create {
        item: json!({
            "id": id,
            "name": name,
            "cron": "0 * * * * *",
            "enabled": true,
            "type": "bash",
            "script": "echo hello",
        }),
    }
}

fn create_prompt_task_op(id: &str) -> AutomationOp {
    AutomationOp::Create {
        item: json!({
            "id": id,
            "name": "Prompt task",
            "cron": "0 * * * * *",
            "enabled": true,
            "type": "prompt",
            "prompt": "Summarize the repo",
            "selectedModel": { "customProviderId": "provider-a", "model": "gpt-5" },
        }),
    }
}

fn store_with_task(op: AutomationOp) -> (AutomationStore, CronTask) {
    let store = AutomationStore::open_in_memory().expect("open store");
    let base = store.snapshot().expect("snapshot").cron.revision;
    let response = store
        .cron_apply(apply_input(base, vec![op]))
        .expect("apply create");
    assert_eq!(response.status, ApplyStatus::Ok);
    let task = response.cron.tasks[0].clone();
    (store, task)
}

#[test]
fn validate_cron_expression_accepts_six_field_syntax() {
    validate_cron_expression("0 * * * * *").expect("validate six-field cron");
}

#[test]
fn validate_cron_expression_rejects_five_field_syntax() {
    let error = validate_cron_expression("* * * * *").expect_err("reject five-field cron");
    assert!(error.contains("六段"));
}

#[test]
fn cron_apply_rejects_stale_revision() {
    let store = AutomationStore::open_in_memory().expect("open store");
    let base = store.snapshot().expect("snapshot").cron.revision;
    store
        .cron_apply(apply_input(base, vec![create_bash_task_op("a", "First")]))
        .expect("first apply");

    let stale = store
        .cron_apply(apply_input(base, vec![create_bash_task_op("b", "Second")]))
        .expect("stale apply returns");
    assert_eq!(stale.status, ApplyStatus::Conflict);
    assert_eq!(stale.cron.tasks.len(), 1);

    let fresh = store
        .cron_apply(apply_input(
            stale.cron.revision,
            vec![create_bash_task_op("b", "Second")],
        ))
        .expect("rebased apply");
    assert_eq!(fresh.status, ApplyStatus::Ok);
    assert_eq!(fresh.cron.tasks.len(), 2);
}

#[test]
fn cron_apply_update_patches_only_named_fields() {
    let (store, task) = store_with_task(create_bash_task_op("a", "First"));
    let revision = store.snapshot().expect("snapshot").cron.revision;
    let response = store
        .cron_apply(apply_input(
            revision,
            vec![AutomationOp::Update {
                id: task.id.clone(),
                patch: json!({ "name": "Renamed" }),
            }],
        ))
        .expect("apply update");
    assert_eq!(response.status, ApplyStatus::Ok);
    let updated = &response.cron.tasks[0];
    assert_eq!(updated.name, "Renamed");
    assert_eq!(updated.script.as_deref(), Some("echo hello"));
    assert!(updated.enabled);
}

#[test]
fn cron_apply_update_switching_kind_drops_stale_config() {
    let (store, task) = store_with_task(create_bash_task_op("a", "First"));
    let revision = store.snapshot().expect("snapshot").cron.revision;
    let response = store
        .cron_apply(apply_input(
            revision,
            vec![AutomationOp::Update {
                id: task.id.clone(),
                patch: json!({
                    "type": "http",
                    "requests": [{ "url": "https://example.com/ping", "method": "GET" }],
                }),
            }],
        ))
        .expect("apply kind switch");
    let updated = &response.cron.tasks[0];
    assert_eq!(updated.kind, "http");
    assert!(updated.script.is_none());
    assert_eq!(updated.requests.as_ref().map(Vec::len), Some(1));
}

#[test]
fn cron_apply_reorder_requires_full_permutation() {
    let store = AutomationStore::open_in_memory().expect("open store");
    let base = store.snapshot().expect("snapshot").cron.revision;
    let response = store
        .cron_apply(apply_input(
            base,
            vec![
                create_bash_task_op("a", "A"),
                create_bash_task_op("b", "B"),
            ],
        ))
        .expect("seed");

    let error = store
        .cron_apply(apply_input(
            response.cron.revision,
            vec![AutomationOp::Reorder {
                ids: vec!["a".to_string()],
            }],
        ))
        .expect_err("partial reorder rejected");
    assert!(error.contains("全部"));

    let reordered = store
        .cron_apply(apply_input(
            response.cron.revision,
            vec![AutomationOp::Reorder {
                ids: vec!["b".to_string(), "a".to_string()],
            }],
        ))
        .expect("full reorder");
    let ids: Vec<&str> = reordered.cron.tasks.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, vec!["b", "a"]);
}

#[test]
fn record_completed_run_decrements_and_disables_at_zero() {
    let store = AutomationStore::open_in_memory().expect("open store");
    let base = store.snapshot().expect("snapshot").cron.revision;
    store
        .cron_apply(apply_input(
            base,
            vec![AutomationOp::Create {
                item: json!({
                    "id": "finite",
                    "name": "Finite",
                    "cron": "0 * * * * *",
                    "enabled": true,
                    "remainingExecutions": 1,
                    "type": "bash",
                    "script": "echo finite",
                }),
            }],
        ))
        .expect("seed finite task");

    store
        .record_completed_run(CompletedRun {
            task_id: "finite".to_string(),
            success: true,
            started_at: db::now_ms(),
            duration_ms: 5,
            exit_code: Some(0),
            output: "ok".to_string(),
            counted: true,
        })
        .expect("record run");

    let snapshot = store.snapshot().expect("snapshot").cron;
    let task = &snapshot.tasks[0];
    assert_eq!(task.remaining_executions, Some(0));
    assert!(!task.enabled);
    let runs = store.list_runs("finite", 10).expect("list runs");
    assert_eq!(runs.len(), 1);
    assert!(runs[0].success);
}

#[test]
fn prompt_run_lifecycle_queue_claim_complete() {
    let (store, task) = store_with_task(create_prompt_task_op("p1"));

    assert!(matches!(
        store.queue_prompt_run(&task).expect("queue prompt run"),
        super::store::PromptQueueOutcome::Queued
    ));

    // Second fire while pending is skipped.
    assert!(matches!(
        store.queue_prompt_run(&task).expect("second queue"),
        super::store::PromptQueueOutcome::SkippedActiveRun
    ));

    let claims = store.claim_prompt_runs().expect("claim");
    assert_eq!(claims.len(), 1);
    let execution_id = claims[0].execution_id.clone();

    // Claim is consuming: a second claim returns nothing.
    assert!(store.claim_prompt_runs().expect("second claim").is_empty());

    let completion = store
        .complete_prompt_run(CompletePromptRunInput {
            execution_id: execution_id.clone(),
            success: true,
            duration_ms: 1200,
            output: "conclusion".to_string(),
        })
        .expect("complete");
    assert_eq!(completion.status, PromptCompletionStatus::Completed);

    let repeat = store
        .complete_prompt_run(CompletePromptRunInput {
            execution_id: execution_id.clone(),
            success: true,
            duration_ms: 1200,
            output: "late".to_string(),
        })
        .expect("repeat complete");
    assert_eq!(repeat.status, PromptCompletionStatus::AlreadyFinished);

    let runs = store.list_runs("p1", 10).expect("list runs");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].output, "conclusion");
}

#[test]
fn released_prompt_run_returns_to_pending() {
    let (store, task) = store_with_task(create_prompt_task_op("p1"));
    assert!(matches!(
        store.queue_prompt_run(&task).expect("queue"),
        super::store::PromptQueueOutcome::Queued
    ));
    let claims = store.claim_prompt_runs().expect("claim");
    assert_eq!(claims.len(), 1);
    let execution_id = claims[0].execution_id.clone();
    store.release_prompt_run(&execution_id).expect("release");
    let reclaimed = store.claim_prompt_runs().expect("reclaim");
    assert_eq!(reclaimed.len(), 1);
    assert_eq!(reclaimed[0].execution_id, execution_id);
}

#[test]
fn recover_marks_interrupted_runs_expired() {
    let (store, task) = store_with_task(create_prompt_task_op("p1"));
    store.queue_prompt_run(&task).expect("queue");
    let recovered = store
        .recover_interrupted_prompt_runs()
        .expect("recover");
    assert_eq!(recovered, 1);

    let runs = store.list_runs("p1", 10).expect("list runs");
    assert_eq!(runs.len(), 1);
    assert!(matches!(runs[0].state, RunState::Expired));
    assert!(runs[0].output.contains("restart"));

    // Completion after expiry is idempotent.
    let completion = store
        .complete_prompt_run(CompletePromptRunInput {
            execution_id: runs[0].id.clone(),
            success: true,
            duration_ms: 10,
            output: "late".to_string(),
        })
        .expect("late completion");
    assert_eq!(completion.status, PromptCompletionStatus::AlreadyFinished);
}

#[test]
fn run_retention_prunes_old_rows() {
    let (store, _task) = store_with_task(create_bash_task_op("a", "A"));
    for index in 0..(db::RUN_RETENTION_PER_TASK + 25) {
        store
            .record_completed_run(CompletedRun {
                task_id: "a".to_string(),
                success: true,
                started_at: db::now_ms() + index as i64,
                duration_ms: 1,
                exit_code: Some(0),
                output: format!("run {index}"),
                counted: false,
            })
            .expect("record run");
    }
    let runs = store.list_runs("a", 500).expect("list runs");
    assert_eq!(runs.len(), db::RUN_RETENTION_PER_TASK as usize);
}

#[test]
fn masked_headers_round_trip_keeps_stored_secret() {
    let store = AutomationStore::open_in_memory().expect("open store");
    let base = store.snapshot().expect("snapshot").cron.revision;
    let response = store
        .cron_apply(apply_input(
            base,
            vec![AutomationOp::Create {
                item: json!({
                    "id": "h1",
                    "name": "Http",
                    "cron": "0 * * * * *",
                    "type": "http",
                    "requests": [{
                        "id": "r1",
                        "url": "https://example.com/hook",
                        "method": "POST",
                        "headers": { "Authorization": "Bearer secret-token" },
                    }],
                }),
            }],
        ))
        .expect("seed http task");

    // A remote client edits the URL and round-trips masked headers.
    let masked = store
        .cron_apply(apply_input(
            response.cron.revision,
            vec![AutomationOp::Update {
                id: "h1".to_string(),
                patch: json!({
                    "requests": [{
                        "id": "r1",
                        "url": "https://example.com/hook-v2",
                        "method": "POST",
                        "headers": { "Authorization": MASKED_HEADER_VALUE },
                    }],
                }),
            }],
        ))
        .expect("masked update");

    let task = &masked.cron.tasks[0];
    let headers = task.requests.as_ref().unwrap()[0].headers.as_ref().unwrap();
    assert_eq!(headers.get("Authorization").map(String::as_str), Some("Bearer secret-token"));
    assert_eq!(task.requests.as_ref().unwrap()[0].url, "https://example.com/hook-v2");
}

#[test]
fn hooks_apply_validates_event_and_conflicts() {
    let store = AutomationStore::open_in_memory().expect("open store");
    let base = store.snapshot().expect("snapshot").hooks.revision;

    let error = store
        .hooks_apply(apply_input(
            base,
            vec![AutomationOp::Create {
                item: json!({
                    "id": "bad",
                    "name": "Bad",
                    "event": "message_update",
                    "type": "command",
                    "script": "echo hi",
                }),
            }],
        ))
        .expect_err("unsupported event rejected");
    assert!(error.contains("event"));

    let ok = store
        .hooks_apply(apply_input(
            base,
            vec![AutomationOp::Create {
                item: json!({
                    "id": "good",
                    "name": "Good",
                    "event": "agent_end",
                    "enabled": true,
                    "type": "command",
                    "script": "echo done",
                }),
            }],
        ))
        .expect("create hook");
    assert_eq!(ok.status, ApplyStatus::Ok);

    let conflict = store
        .hooks_apply(apply_input(base, vec![]))
        .expect("stale hooks apply");
    assert_eq!(conflict.status, ApplyStatus::Conflict);
}
