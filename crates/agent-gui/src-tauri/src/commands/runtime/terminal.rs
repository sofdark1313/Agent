use std::sync::Arc;

use tauri::State;

use crate::runtime::sftp::SftpSessionRegistry;
use crate::runtime::terminal::{
    terminal_shell_options as runtime_terminal_shell_options, SshTerminalTabsSnapshot,
    TerminalListResponse, TerminalReadTailResponse, TerminalSessionRecord, TerminalSessionRegistry,
    TerminalShellOptionsResponse, TerminalSnapshotResponse, TerminalSshCreateResponse,
    TerminalSshExecResponse, TerminalSshLatencyResponse, TerminalStreamSnapshotResponse,
};

#[tauri::command(rename_all = "snake_case")]
pub fn terminal_shell_options() -> TerminalShellOptionsResponse {
    runtime_terminal_shell_options()
}

#[tauri::command(rename_all = "snake_case")]
pub fn terminal_list(
    registry: State<'_, Arc<TerminalSessionRegistry>>,
    project_path_key: Option<String>,
) -> TerminalListResponse {
    registry.list(project_path_key)
}

#[tauri::command(rename_all = "snake_case")]
pub fn terminal_create(
    registry: State<'_, Arc<TerminalSessionRegistry>>,
    cwd: String,
    project_path_key: Option<String>,
    shell: Option<String>,
    title: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<TerminalSnapshotResponse, String> {
    registry.create(cwd, project_path_key, shell, title, cols, rows)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn terminal_create_ssh(
    registry: State<'_, Arc<TerminalSessionRegistry>>,
    cwd: String,
    project_path_key: Option<String>,
    ssh_host_id: String,
    title: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    sftp_enabled: Option<bool>,
) -> Result<TerminalSshCreateResponse, String> {
    registry
        .inner()
        .clone()
        .create_ssh(
            cwd,
            project_path_key,
            ssh_host_id,
            title,
            cols,
            rows,
            sftp_enabled.unwrap_or(false),
        )
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn terminal_answer_ssh_prompt(
    registry: State<'_, Arc<TerminalSessionRegistry>>,
    prompt_id: String,
    prompt_answer: Option<String>,
    trust_host_key: Option<bool>,
) -> Result<TerminalSshCreateResponse, String> {
    registry
        .inner()
        .clone()
        .answer_ssh_prompt(prompt_id, prompt_answer, trust_host_key.unwrap_or(false))
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub fn terminal_cancel_ssh_prompt(
    registry: State<'_, Arc<TerminalSessionRegistry>>,
    prompt_id: String,
) -> Result<(), String> {
    registry.cancel_ssh_prompt(prompt_id)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn terminal_ssh_latency(
    registry: State<'_, Arc<TerminalSessionRegistry>>,
    session_id: String,
) -> Result<TerminalSshLatencyResponse, String> {
    registry.ssh_latency(session_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn terminal_ssh_exec(
    registry: State<'_, Arc<TerminalSessionRegistry>>,
    session_id: String,
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    max_bytes: Option<usize>,
) -> Result<TerminalSshExecResponse, String> {
    registry
        .inner()
        .clone()
        .ssh_exec(session_id, command, cwd, timeout_ms, max_bytes)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub fn ssh_terminal_tabs_list(
    registry: State<'_, Arc<TerminalSessionRegistry>>,
    project_path_key: String,
) -> Result<SshTerminalTabsSnapshot, String> {
    registry.ssh_terminal_tabs_list(project_path_key)
}

#[tauri::command(rename_all = "snake_case")]
pub fn ssh_terminal_tab_open(
    registry: State<'_, Arc<TerminalSessionRegistry>>,
    session_id: String,
    kind: String,
) -> Result<SshTerminalTabsSnapshot, String> {
    registry.ssh_terminal_tab_open(session_id, kind)
}

#[tauri::command(rename_all = "snake_case")]
pub fn ssh_terminal_tab_close(
    registry: State<'_, Arc<TerminalSessionRegistry>>,
    tab_id: String,
) -> Result<SshTerminalTabsSnapshot, String> {
    registry.ssh_terminal_tab_close(tab_id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn terminal_stream_attach(
    registry: State<'_, Arc<TerminalSessionRegistry>>,
    session_id: String,
    max_bytes: Option<usize>,
) -> Result<TerminalStreamSnapshotResponse, String> {
    registry.stream_attach(session_id, max_bytes)
}

#[tauri::command(rename_all = "snake_case")]
pub fn terminal_stream_input(
    registry: State<'_, Arc<TerminalSessionRegistry>>,
    session_id: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    registry.input_bytes(session_id, bytes)
}

#[tauri::command(rename_all = "snake_case")]
pub fn terminal_stream_resize(
    registry: State<'_, Arc<TerminalSessionRegistry>>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    registry.stream_resize(session_id, cols, rows)
}

#[tauri::command(rename_all = "snake_case")]
pub fn terminal_rename(
    registry: State<'_, Arc<TerminalSessionRegistry>>,
    session_id: String,
    title: String,
) -> Result<TerminalSessionRecord, String> {
    registry.rename(session_id, title)
}

#[tauri::command(rename_all = "snake_case")]
pub fn terminal_close(
    registry: State<'_, Arc<TerminalSessionRegistry>>,
    sftp_registry: State<'_, Arc<SftpSessionRegistry>>,
    session_id: String,
) -> Result<TerminalSessionRecord, String> {
    let response = registry.close(session_id)?;
    sftp_registry.close_session(&response.id);
    Ok(response)
}

#[tauri::command(rename_all = "snake_case")]
pub fn terminal_close_project(
    registry: State<'_, Arc<TerminalSessionRegistry>>,
    sftp_registry: State<'_, Arc<SftpSessionRegistry>>,
    project_path_key: String,
) -> Result<TerminalListResponse, String> {
    let response = registry.close_project(project_path_key)?;
    for session in &response.sessions {
        sftp_registry.close_session(&session.id);
    }
    Ok(response)
}

#[tauri::command(rename_all = "snake_case")]
pub fn terminal_read_tail(
    registry: State<'_, Arc<TerminalSessionRegistry>>,
    project_path_key: String,
    session_id: Option<String>,
    max_bytes: Option<usize>,
) -> Result<TerminalReadTailResponse, String> {
    registry.read_tail(project_path_key, session_id, max_bytes)
}
