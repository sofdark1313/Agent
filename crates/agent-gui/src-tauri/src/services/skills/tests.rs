use super::*;
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

fn write_skill(root: &Path, name: &str, description: &str) -> PathBuf {
    let dir = root.join(name);
    fs::create_dir_all(&dir).expect("create skill dir");
    fs::write(
        dir.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n"),
    )
    .expect("write skill");
    dir
}

#[test]
fn skill_name_rejects_windows_reserved_names() {
    assert!(sanitize_skill_name("safe-skill").is_ok());
    assert!(sanitize_skill_name("con").is_err());
    assert!(sanitize_skill_name("aux").is_err());
    assert!(sanitize_skill_name("com9").is_err());
    assert!(sanitize_skill_name("com0").is_ok());
}

#[test]
fn skill_rel_path_rejects_windows_reserved_components() {
    assert!(sanitize_skill_child_rel_path("references/notes.md").is_ok());
    assert!(sanitize_skill_child_rel_path("references/con.md").is_err());
    assert!(sanitize_skill_child_rel_path("references/LPT1.txt").is_err());
    assert!(sanitize_skill_child_rel_path("references/com0.txt").is_ok());
}

#[test]
fn github_tree_url_parses_ref_and_subpath() {
    let source = parse_github_url(
        "https://github.com/owner/repo/tree/main/skills/example",
        DEFAULT_GITHUB_REF,
    )
    .expect("parse github url");

    assert_eq!(source.owner, "owner");
    assert_eq!(source.repo, "repo");
    assert_eq!(source.git_ref, "main");
    assert_eq!(source.subpath.as_deref(), Some("skills/example"));
}

#[test]
fn discover_skill_dirs_supports_repo_skills_folder() {
    let tmp = TempDir::new("liveagent-skill-discover-test").expect("temp dir");
    let skills_root = tmp.path().join("repo").join("skills");
    write_skill(&skills_root, "first-skill", "First");
    write_skill(&skills_root, "second-skill", "Second");

    let dirs = discover_skill_dirs(&tmp.path().join("repo"));
    let names = dirs
        .iter()
        .map(|path| path.file_name().unwrap().to_string_lossy().to_string())
        .collect::<Vec<_>>();

    assert_eq!(names, vec!["first-skill", "second-skill"]);
}

#[test]
fn discover_skill_dirs_does_not_let_root_readme_override_skills_folder() {
    let tmp = TempDir::new("liveagent-readme-root-discover-test").expect("temp dir");
    let repo = tmp.path().join("repo");
    fs::create_dir_all(&repo).expect("create repo");
    fs::write(repo.join("README.md"), "# Repo README\n").expect("write repo readme");
    write_skill(&repo.join("skills"), "nested-skill", "Nested");

    let dirs = discover_skill_dirs(&repo);
    let names = dirs
        .iter()
        .map(|path| path.file_name().unwrap().to_string_lossy().to_string())
        .collect::<Vec<_>>();

    assert_eq!(names, vec!["nested-skill"]);
}

#[test]
fn readme_frontmatter_is_used_as_skill_metadata_fallback() {
    let tmp = TempDir::new("liveagent-readme-frontmatter-test").expect("temp dir");
    let dir = tmp.path().join("readme-skill");
    fs::create_dir_all(&dir).expect("create skill dir");
    fs::write(
        dir.join("README.md"),
        "---\nname: readme-skill\ndescription: README metadata\n---\n\n# README Skill\n",
    )
    .expect("write readme");

    let metadata = read_skill_metadata_from_dir(&dir).expect("read metadata");
    assert_eq!(metadata.name, "readme-skill");
    assert_eq!(metadata.description, "README metadata");
    assert_eq!(metadata.metadata_file.file_name().unwrap(), "README.md");

    let validation = validate_skill_dir(&dir);
    assert!(validation.ok, "{:?}", validation.errors);
}

#[test]
fn readme_without_frontmatter_derives_metadata_for_management() {
    let tmp = TempDir::new("liveagent-plain-readme-test").expect("temp dir");
    let dir = tmp.path().join("plain-readme-skill");
    fs::create_dir_all(&dir).expect("create skill dir");
    fs::write(
        dir.join("README.md"),
        "# Plain README Skill\n\nFollow this README as the skill instructions.\n",
    )
    .expect("write readme");

    let raw_metadata =
        read_skill_metadata_file(&dir.join("README.md")).expect("read raw metadata");
    assert!(raw_metadata.name.is_none());
    assert!(raw_metadata.description.is_none());

    let metadata = read_skill_metadata_from_dir(&dir).expect("derive metadata");
    assert_eq!(metadata.name, "plain-readme-skill");
    assert_eq!(metadata.description, "Plain README Skill");

    let validation = validate_skill_dir(&dir);
    assert!(validation.ok, "{:?}", validation.errors);
}

#[test]
fn readme_empty_frontmatter_derives_metadata_for_management() {
    let tmp = TempDir::new("liveagent-empty-readme-frontmatter-test").expect("temp dir");
    let dir = tmp.path().join("empty-readme-metadata");
    fs::create_dir_all(&dir).expect("create skill dir");
    fs::write(
        dir.join("README.md"),
        "---\n---\n\n# Empty README Metadata\n\nUse the README content.\n",
    )
    .expect("write readme");

    let metadata = read_skill_metadata_from_dir(&dir).expect("derive metadata");
    assert_eq!(metadata.name, "empty-readme-metadata");
    assert_eq!(metadata.description, "Empty README Metadata");

    let validation = validate_skill_dir(&dir);
    assert!(validation.ok, "{:?}", validation.errors);
}

#[test]
fn readme_partial_frontmatter_is_invalid_metadata() {
    let tmp = TempDir::new("liveagent-partial-readme-frontmatter-test").expect("temp dir");
    let dir = tmp.path().join("partial-readme-metadata");
    fs::create_dir_all(&dir).expect("create skill dir");
    fs::write(
        dir.join("README.md"),
        "---\nname: partial-readme-metadata\n---\n\n# Partial README Metadata\n",
    )
    .expect("write readme");

    let error = read_skill_metadata_from_dir(&dir).expect_err("partial metadata must fail");
    assert!(
        error.contains("Missing skill description"),
        "unexpected error: {error}"
    );

    let validation = validate_skill_dir(&dir);
    assert!(!validation.ok);
    assert!(
        validation
            .errors
            .iter()
            .any(|error| error.contains("Missing 'description'")),
        "{:?}",
        validation.errors
    );
}

#[test]
fn readme_inside_existing_skill_is_not_a_discovery_candidate() {
    let tmp = TempDir::new("liveagent-nested-readme-discovery-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let skill_dir = write_skill(&root, "documented-skill", "Documented");
    let reference_dir = skill_dir.join("references");
    fs::create_dir_all(&reference_dir).expect("create references");
    let readme = reference_dir.join("README.md");
    fs::write(&readme, "# Reference README\n").expect("write nested readme");

    assert!(!should_include_metadata_candidate(&root, &readme));
    assert!(should_include_metadata_candidate(
        &root,
        &skill_dir.join("SKILL.md")
    ));
}

#[test]
fn install_skill_dir_with_backup_preserves_existing_target() {
    let tmp = TempDir::new("liveagent-skill-backup-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let source_a = tmp.path().join("source-a");
    let source_b = tmp.path().join("source-b");
    write_skill(&source_a, "sample-skill", "Old");
    write_skill(&source_b, "sample-skill", "New");

    let first = install_skill_dir(
        &root,
        &source_a.join("sample-skill"),
        "sample-skill",
        "fail",
        None,
    )
    .expect("first install");
    assert!(first.backup.is_none());

    let second = install_skill_dir(
        &root,
        &source_b.join("sample-skill"),
        "sample-skill",
        "backup",
        None,
    )
    .expect("second install");

    assert!(second.backup.is_some());
    assert!(root.join(".backups").exists());
}

#[test]
fn builtin_seed_backs_up_invalid_target_before_writing() {
    let tmp = TempDir::new("liveagent-builtin-seed-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let invalid_target = root.join("skills-installer");
    fs::create_dir_all(&invalid_target).expect("create invalid target");
    fs::write(invalid_target.join("SKILL.md"), "not valid frontmatter\n")
        .expect("write invalid skill");

    let seeded = ensure_builtin_agent_skills_in_root(&root).expect("seed builtins");
    let installer = seeded
        .iter()
        .find(|item| item.name == "skills-installer")
        .expect("installer seed result");

    assert_eq!(installer.action, "replaced_invalid");
    assert!(installer.backup.is_some());
    assert!(root.join(".backups").exists());
    let validation = validate_skill_dir(&root.join("skills-installer"));
    assert!(validation.ok, "{:?}", validation.errors);
}

#[test]
fn builtin_seed_updates_changed_valid_target_before_writing() {
    let tmp = TempDir::new("liveagent-builtin-update-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let old_target = root.join("skills-creator");
    fs::create_dir_all(&old_target).expect("create old target");
    fs::write(
        old_target.join("SKILL.md"),
        "---\nname: skills-creator\ndescription: Old valid creator\n---\n\n# Old Creator\n\nUse the old workflow.\n",
    )
    .expect("write old skill");

    let seeded = ensure_builtin_agent_skills_in_root(&root).expect("seed builtins");
    let creator = seeded
        .iter()
        .find(|item| item.name == "skills-creator")
        .expect("creator seed result");

    assert_eq!(creator.action, "updated");
    assert!(creator.backup.is_some());
    let content =
        fs::read_to_string(root.join("skills-creator").join("SKILL.md")).expect("read seeded");
    assert!(content.contains("Prefer English for generated skill documentation"));
    let validation = validate_skill_dir(&root.join("skills-creator"));
    assert!(validation.ok, "{:?}", validation.errors);
}

#[test]
fn builtin_seed_removes_retired_builtin_files() {
    let tmp = TempDir::new("liveagent-builtin-retired-file-test").expect("temp dir");
    let root = tmp.path().join("skills");

    ensure_builtin_agent_skills_in_root(&root).expect("seed builtins");
    let creator_dir = root.join("skills-creator");
    let retired_script = creator_dir.join("scripts").join("old_helper.py");
    fs::create_dir_all(retired_script.parent().expect("script parent"))
        .expect("create scripts");
    fs::write(&retired_script, "#!/usr/bin/env python3\nprint('old')\n")
        .expect("write retired script");

    let seeded = ensure_builtin_agent_skills_in_root(&root).expect("reseed builtins");
    let creator = seeded
        .iter()
        .find(|item| item.name == "skills-creator")
        .expect("creator seed result");

    assert_eq!(creator.action, "updated");
    assert!(creator.backup.is_some());
    assert!(!root.join("skills-creator").join("scripts").exists());
}

#[test]
fn list_installed_skills_skips_hidden_backup_dirs() {
    let tmp = TempDir::new("liveagent-skill-list-test").expect("temp dir");
    let root = tmp.path().join("skills");
    write_skill(&root, "active-skill", "Active");
    write_skill(&root.join(".backups"), "backup-skill", "Backup");

    let (skills, invalid) = list_installed_skills(&root).expect("list skills");

    assert!(invalid.is_empty(), "{invalid:?}");
    assert_eq!(
        skills
            .iter()
            .map(|skill| skill.name.as_str())
            .collect::<Vec<_>>(),
        vec!["active-skill"]
    );
}

#[test]
fn install_source_from_local_skill_archive_installs_skill() {
    let tmp = TempDir::new("liveagent-skill-archive-install-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let archive = tmp.path().join("archive-skill.skill");
    {
        let file = fs::File::create(&archive).expect("archive file");
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer
            .start_file("archive-skill/SKILL.md", options)
            .expect("start skill file");
        writer
            .write_all(
                b"---\nname: archive-skill\ndescription: Archive install\n---\n\n# Archive Skill\n",
            )
            .expect("write skill file");
        writer.finish().expect("finish archive");
    }
    let payload = json!({
        "source": archive.to_string_lossy(),
        "conflict": "fail"
    });
    let payload = payload.as_object().expect("payload object");

    let installed = install_source_from_payload(&root, payload).expect("install archive");

    assert_eq!(installed.len(), 1);
    assert_eq!(installed[0].name, "archive-skill");
    assert!(root.join("archive-skill").join("SKILL.md").is_file());
}

#[test]
fn clawhub_download_url_preserves_slug_and_tag_params() {
    let url = clawhub_download_url_for_slug("owner/example-skill", Some("v1.2.3"))
        .expect("download url");
    let parsed = reqwest::Url::parse(&url).expect("parse url");
    let pairs = parsed
        .query_pairs()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect::<HashMap<_, _>>();

    assert_eq!(parsed.scheme(), "https");
    assert_eq!(parsed.host_str(), Some("clawhub.ai"));
    assert_eq!(parsed.path(), "/api/v1/download");
    assert_eq!(
        pairs.get("slug").map(String::as_str),
        Some("owner/example-skill")
    );
    assert_eq!(pairs.get("tag").map(String::as_str), Some("v1.2.3"));
}

#[test]
fn normalize_clawhub_skill_card_supports_search_shape() {
    let raw = json!({
        "slug": "owner/example-skill",
        "displayName": "Example Skill",
        "summary": "Example summary",
        "latestVersion": { "version": "1.0.0" },
        "stats": {
            "downloads": 11,
            "stars": 7,
            "installsCurrent": 3
        },
        "updatedAt": 12345,
        "owner": { "handle": "owner" }
    });

    let card = normalize_clawhub_skill_card(&raw).expect("normalize card");

    assert_eq!(card.slug, "owner/example-skill");
    assert_eq!(card.display_name, "Example Skill");
    assert_eq!(card.latest_version.as_deref(), Some("1.0.0"));
    assert_eq!(card.downloads, 11);
    assert_eq!(card.stars, 7);
    assert_eq!(card.installs_current, 3);
    assert_eq!(card.owner_handle.as_deref(), Some("owner"));
    assert!(card.download_url.contains("/api/v1/download"));
}

#[test]
fn install_source_persists_clawhub_metadata_when_slug_is_present() {
    let tmp = TempDir::new("liveagent-skill-clawhub-meta-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let source = tmp.path().join("source");
    write_skill(&source, "clawhub-skill", "ClawHub install");
    let payload = json!({
        "source": source.to_string_lossy(),
        "conflict": "fail",
        "slug": "owner/clawhub-skill",
        "version": "1.0.0",
        "publishedAt": 12345
    });
    let payload = payload.as_object().expect("payload object");

    let installed = install_source_from_payload(&root, payload).expect("install skill");
    let source_metadata =
        read_skill_source_metadata(&root.join(&installed[0].name)).expect("read source meta");

    assert_eq!(source_metadata.registry, "clawhub");
    assert_eq!(source_metadata.slug, "owner/clawhub-skill");
    assert_eq!(source_metadata.version.as_deref(), Some("1.0.0"));
    assert_eq!(source_metadata.published_at, Some(12345));
}

#[test]
fn validate_and_package_round_trip() {
    let tmp = TempDir::new("liveagent-skill-package-test").expect("temp dir");
    let root = tmp.path().join("skills");
    write_skill(&root, "package-skill", "Package test");

    let validation =
        validate_installed_skill(&root, "package-skill").expect("validate installed skill");
    assert!(validation.ok, "{:?}", validation.errors);

    let package = package_installed_skill(&root, "package-skill").expect("package skill");
    assert!(Path::new(&package.archive).exists());
}

#[test]
fn delete_installed_skill_removes_user_skill() {
    let tmp = TempDir::new("liveagent-skill-delete-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let skill_dir = write_skill(&root, "delete-skill", "Delete test");

    let deleted = delete_installed_skill(&root, "delete-skill").expect("delete skill");

    assert_eq!(deleted.name, "delete-skill");
    assert_eq!(deleted.target, display_path(&skill_dir));
    assert!(!skill_dir.exists());
}

#[test]
fn delete_installed_skill_rejects_builtin_skill() {
    let tmp = TempDir::new("liveagent-skill-delete-builtin-test").expect("temp dir");
    let root = tmp.path().join("skills");
    write_skill(&root, "skills-installer", "Built-in replacement");

    let error =
        delete_installed_skill(&root, "skills-installer").expect_err("delete should fail");

    assert!(
        error.contains("cannot modify built-in Skill"),
        "unexpected error: {error}"
    );
    assert!(root.join("skills-installer").exists());
}

#[test]
fn delete_installed_skill_rejects_missing_skill() {
    let tmp = TempDir::new("liveagent-skill-delete-missing-test").expect("temp dir");
    let root = tmp.path().join("skills");

    let error = delete_installed_skill(&root, "missing-skill").expect_err("delete should fail");

    assert!(
        error.contains("does not exist") || error.contains("cannot be inspected"),
        "unexpected error: {error}"
    );
}

#[test]
fn delete_installed_skill_rejects_non_directory_target() {
    let tmp = TempDir::new("liveagent-skill-delete-file-test").expect("temp dir");
    let root = tmp.path().join("skills");
    fs::create_dir_all(&root).expect("create skills root");
    let file = root.join("file-skill");
    fs::write(&file, "not a directory").expect("write file target");

    let error = delete_installed_skill(&root, "file-skill").expect_err("delete should fail");

    assert!(
        error.contains("requires an installed Skill directory"),
        "unexpected error: {error}"
    );
    assert!(file.exists());
}

#[test]
fn validate_allows_nested_metadata_frontmatter() {
    let tmp = TempDir::new("liveagent-skill-frontmatter-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let dir = root.join("metadata-skill");
    fs::create_dir_all(&dir).expect("create skill dir");
    fs::write(
        dir.join("SKILL.md"),
        "---\nname: metadata-skill\ndescription: Metadata test\nmetadata:\n  short-description: Nested metadata\n---\n\n# Metadata Skill\n",
    )
    .expect("write skill");

    let validation = validate_installed_skill(&root, "metadata-skill").expect("validate skill");

    assert!(validation.ok, "{:?}", validation.errors);
}

#[test]
fn validate_allows_single_line_frontmatter() {
    let tmp = TempDir::new("liveagent-skill-inline-frontmatter-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let dir = root.join("security-threat-model");
    fs::create_dir_all(&dir).expect("create skill dir");
    fs::write(
        dir.join("SKILL.md"),
        "--- name: security-threat-model description: Develop threat models and security analysis for software systems --- Use this skill when reviewing security risks.\n",
    )
    .expect("write skill");

    let metadata = read_skill_metadata_from_dir(&dir).expect("read metadata");
    assert_eq!(metadata.name, "security-threat-model");
    assert_eq!(
        metadata.description,
        "Develop threat models and security analysis for software systems"
    );

    let validation =
        validate_installed_skill(&root, "security-threat-model").expect("validate skill");
    assert!(validation.ok, "{:?}", validation.errors);
}

#[test]
fn validate_accepts_non_english_markdown_documentation() {
    let tmp = TempDir::new("liveagent-skill-language-doc-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let dir = root.join("multilingual-skill");
    fs::create_dir_all(&dir).expect("create skill dir");
    fs::write(
        dir.join("SKILL.md"),
        "---\nname: multilingual-skill\ndescription: \u{591A}\u{8BED}\u{8A00}\u{6587}\u{6863}\u{6D4B}\u{8BD5}\n---\n\n# \u{591A}\u{8BED}\u{8A00} Skill\n\n\u{4FDD}\u{5B58}\u{524D}\u{5148}\u{68C0}\u{67E5}\u{5DE5}\u{4F5C}\u{6D41}\u{3002}\n",
    )
    .expect("write skill");

    let validation =
        validate_installed_skill(&root, "multilingual-skill").expect("validate skill");

    assert!(validation.ok, "{:?}", validation.errors);
}

#[test]
fn create_skill_accepts_non_english_body() {
    let tmp = TempDir::new("liveagent-skill-create-language-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let payload = json!({
        "name": "multilingual-create-skill",
        "description": "\u{521B}\u{5EFA}\u{4E2D}\u{6587}\u{6587}\u{6863}",
        "body": "# \u{4E2D}\u{6587} Skill\n\n\u{6309}\u{6B65}\u{9AA4}\u{6267}\u{884C}\u{5DE5}\u{4F5C}\u{6D41}\u{3002}",
        "conflict": "fail"
    });
    let payload = payload.as_object().expect("payload object");

    let result = create_skill_from_payload(&root, payload).expect("create should succeed");

    assert_eq!(result.name, "multilingual-create-skill");
    let content = fs::read_to_string(root.join("multilingual-create-skill").join("SKILL.md"))
        .expect("read created skill");
    assert!(content.contains("\u{4E2D}\u{6587} Skill"));
}

#[test]
fn create_skill_rejects_builtin_skill_names() {
    let tmp = TempDir::new("liveagent-skill-create-builtin-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let payload = json!({
        "name": "skills-creator",
        "description": "Attempt to replace built-in creator",
        "body": "# Replacement\n\nDo not allow this.",
        "conflict": "overwrite"
    });
    let payload = payload.as_object().expect("payload object");

    let error = create_skill_from_payload(&root, payload).expect_err("create should fail");

    assert!(
        error.contains("cannot modify built-in Skill"),
        "unexpected error: {error}"
    );
}

#[test]
fn install_source_rejects_builtin_skill_names() {
    let tmp = TempDir::new("liveagent-skill-install-builtin-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let source = tmp.path().join("source");
    write_skill(&source, "skills-installer", "Replacement");
    let payload = json!({
        "source": source.to_string_lossy(),
        "conflict": "overwrite"
    });
    let payload = payload.as_object().expect("payload object");

    let error = install_source_from_payload(&root, payload).expect_err("install should fail");

    assert!(
        error.contains("cannot modify built-in Skill"),
        "unexpected error: {error}"
    );
}

#[test]
fn safe_extract_zip_rejects_parent_traversal() {
    let tmp = TempDir::new("liveagent-skill-zip-test").expect("temp dir");
    let archive = tmp.path().join("bad.skill");
    {
        let file = fs::File::create(&archive).expect("archive file");
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer
            .start_file("../evil.txt", options)
            .expect("start unsafe file");
        writer.write_all(b"bad").expect("write unsafe file");
        writer.finish().expect("finish archive");
    }

    let error = safe_extract_zip(&archive, &tmp.path().join("out"))
        .expect_err("zip slip should be rejected");
    assert!(error.contains("escapes") || error.contains("unsafe"));
}

#[test]
fn install_skill_dir_stages_source_metadata_atomically_and_drains_staging() {
    let tmp = TempDir::new("liveagent-skill-meta-atomic-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let source = tmp.path().join("source");
    write_skill(&source, "meta-skill", "Meta");
    let meta = serde_json::to_vec_pretty(&json!({
        "registry": "clawhub",
        "slug": "owner/meta-skill",
        "version": "1.0.0",
        "publishedAt": 1u64,
    }))
    .expect("meta bytes");

    let result = install_skill_dir(
        &root,
        &source.join("meta-skill"),
        "meta-skill",
        "fail",
        Some(&meta),
    )
    .expect("install");

    assert_eq!(result.name, "meta-skill");
    // _meta.json swaps in together with the content, never as a later write.
    let source_meta =
        read_skill_source_metadata(&root.join("meta-skill")).expect("source metadata");
    assert_eq!(source_meta.slug, "owner/meta-skill");
    let staging = root.join(".staging");
    if staging.exists() {
        assert_eq!(fs::read_dir(&staging).expect("staging").count(), 0);
    }
}

#[test]
fn install_skill_dir_failure_leaves_existing_target_untouched() {
    let tmp = TempDir::new("liveagent-skill-fail-safe-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let good_source = tmp.path().join("good");
    write_skill(&good_source, "stable-skill", "Stable");
    install_skill_dir(
        &root,
        &good_source.join("stable-skill"),
        "stable-skill",
        "fail",
        None,
    )
    .expect("initial install");

    // The staged copy fails validation (metadata name mismatch); the old
    // copy-in-place implementation had already deleted the live target here.
    let bad_source = tmp.path().join("bad");
    let bad_dir = write_skill(&bad_source, "different-name", "Bad");
    let error = install_skill_dir(&root, &bad_dir, "stable-skill", "overwrite", None)
        .expect_err("name mismatch should fail");
    assert!(error.contains("does not match"), "unexpected error: {error}");

    let content = fs::read_to_string(root.join("stable-skill").join("SKILL.md"))
        .expect("target survives failed overwrite");
    assert!(content.contains("description: Stable"));
}

#[test]
fn concurrent_same_name_installs_serialize_into_one_target_and_complete_backups() {
    const WRITERS: usize = 4;
    let tmp = TempDir::new("liveagent-skill-race-same-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(WRITERS));

    let handles: Vec<_> = (0..WRITERS)
        .map(|index| {
            let source_root = tmp.path().join(format!("source-{index}"));
            let source_dir = write_skill(&source_root, "racy-skill", &format!("Writer {index}"));
            let root = root.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                install_skill_dir(&root, &source_dir, "racy-skill", "backup", None)
            })
        })
        .collect();
    for handle in handles {
        handle.join().expect("join writer").expect("install succeeds");
    }

    // Exactly one complete live target...
    let live = fs::read_to_string(root.join("racy-skill").join("SKILL.md")).expect("live skill");
    assert!(live.contains("name: racy-skill"));
    // ...plus WRITERS-1 complete backups with distinct names.
    let backups: Vec<_> = fs::read_dir(root.join(".backups"))
        .expect("backups dir")
        .flatten()
        .collect();
    assert_eq!(backups.len(), WRITERS - 1);
    for backup in backups {
        let content =
            fs::read_to_string(backup.path().join("SKILL.md")).expect("backup is complete");
        assert!(content.contains("name: racy-skill"));
    }
}

#[test]
fn concurrent_distinct_installs_all_succeed_and_staging_is_drained() {
    const WRITERS: usize = 4;
    let tmp = TempDir::new("liveagent-skill-race-distinct-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(WRITERS));

    let handles: Vec<_> = (0..WRITERS)
        .map(|index| {
            let name = format!("parallel-skill-{index}");
            let source_root = tmp.path().join(format!("source-{index}"));
            let source_dir = write_skill(&source_root, &name, "Parallel");
            let root = root.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                install_skill_dir(&root, &source_dir, &name, "fail", None)
            })
        })
        .collect();
    for handle in handles {
        handle.join().expect("join writer").expect("install succeeds");
    }

    let (skills, invalid) = list_installed_skills(&root).expect("list skills");
    assert_eq!(skills.len(), WRITERS);
    assert!(invalid.is_empty(), "unexpected invalid entries: {invalid:?}");
    assert_eq!(
        fs::read_dir(root.join(".staging")).expect("staging").count(),
        0
    );
}

#[test]
fn install_source_cancel_flag_aborts_before_touching_target() {
    let tmp = TempDir::new("liveagent-skill-cancel-test").expect("temp dir");
    let root = tmp.path().join("skills");
    let source = tmp.path().join("source");
    write_skill(&source, "cancel-skill", "Cancel");
    let payload = json!({
        "source": source.to_string_lossy(),
        "conflict": "fail"
    });
    let payload = payload.as_object().expect("payload object");

    let error = install_source_from_payload_with_progress(&root, payload, |_| {}, &|| true)
        .expect_err("cancelled install");

    assert_eq!(error, INSTALL_CANCELLED_ERROR);
    assert!(!root.join("cancel-skill").exists());
}

#[test]
fn cancel_install_job_flags_running_jobs_and_rejects_finished_ones() {
    let job_id = uuid::Uuid::new_v4().to_string();
    let now = now_millis();
    insert_install_job(SkillInstallJobState {
        job_id: job_id.clone(),
        phase: "downloading".to_string(),
        source: "https://example.test/skill.zip".to_string(),
        label: None,
        slug: None,
        version: None,
        downloaded_bytes: 0,
        total_bytes: None,
        message: None,
        error: None,
        installed: None,
        started_at: now,
        updated_at: now,
        finished_at: None,
        cancel_requested: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
    })
    .expect("insert job");

    cancel_install_job(&job_id).expect("cancel running job");
    let flagged = skill_install_jobs()
        .lock()
        .expect("jobs lock")
        .get(&job_id)
        .expect("job present")
        .cancel_requested
        .load(std::sync::atomic::Ordering::Relaxed);
    assert!(flagged);

    update_install_job(&job_id, |job| {
        job.phase = "cancelled".to_string();
        job.finished_at = Some(now_millis());
    })
    .expect("finish job");
    let error = cancel_install_job(&job_id).expect_err("finished job cannot be cancelled");
    assert!(error.contains("already finished"));
}
