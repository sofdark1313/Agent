use std::sync::Arc;
use std::time::Instant;

use tokio::sync::{mpsc, watch};
use tokio_stream::wrappers::ReceiverStream;
use uuid::Uuid;

use crate::commands::settings::RemoteSettingsPayload;
use crate::runtime::project_path::{
    project_path_key as normalize_project_path_key, project_path_keys_equal,
};
use crate::runtime::terminal::{
    terminal_shell_options, SshTerminalTabRecord, SshTerminalTabsSnapshot, TerminalEventPayload,
    TerminalSessionRecord, TerminalShellOption, TerminalSnapshotResponse,
    TerminalSshCreateResponse, TerminalStreamEventPayload, TerminalStreamSnapshotResponse,
};

use super::*;

impl GatewayController {
    pub(crate) fn spawn_terminal_stream(
        self: &Arc<Self>,
        client: proto::agent_gateway_client::AgentGatewayClient<tonic::transport::Channel>,
        config: RemoteSettingsPayload,
        stop_rx: watch::Receiver<bool>,
    ) -> tauri::async_runtime::JoinHandle<()> {
        let controller = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            controller
                .run_terminal_stream(client, config, stop_rx)
                .await;
        })
    }

    pub(crate) async fn run_terminal_stream(
        self: Arc<Self>,
        client: proto::agent_gateway_client::AgentGatewayClient<tonic::transport::Channel>,
        config: RemoteSettingsPayload,
        mut stop_rx: watch::Receiver<bool>,
    ) {
        let mut reconnect_delay = GATEWAY_TERMINAL_STREAM_RECONNECT_MIN;

        loop {
            if *stop_rx.borrow() {
                break;
            }

            let attempt_started = Instant::now();
            let result = Arc::clone(&self)
                .run_terminal_stream_once(client.clone(), config.clone(), stop_rx.clone())
                .await;
            if *stop_rx.borrow() {
                break;
            }
            self.set_terminal_stream_sender(None);

            if attempt_started.elapsed() >= GATEWAY_TERMINAL_STREAM_STABLE_AFTER {
                reconnect_delay = GATEWAY_TERMINAL_STREAM_RECONNECT_MIN;
            }
            match result {
                Ok(()) => eprintln!("gateway terminal stream closed; reconnecting"),
                Err(error) => eprintln!("gateway terminal stream stopped: {error}; reconnecting"),
            }

            let delay = reconnect_delay;
            reconnect_delay =
                std::cmp::min(reconnect_delay * 2, GATEWAY_TERMINAL_STREAM_RECONNECT_MAX);
            tokio::select! {
                changed = stop_rx.changed() => {
                    if changed.is_err() || *stop_rx.borrow() {
                        break;
                    }
                }
                _ = tokio::time::sleep(delay) => {}
            }
        }

        self.set_terminal_stream_sender(None);
    }

    pub(crate) async fn run_terminal_stream_once(
        self: Arc<Self>,
        mut client: proto::agent_gateway_client::AgentGatewayClient<tonic::transport::Channel>,
        config: RemoteSettingsPayload,
        mut stop_rx: watch::Receiver<bool>,
    ) -> Result<(), String> {
        let (terminal_tx, terminal_rx) = mpsc::channel::<proto::TerminalStreamFrame>(4096);

        let result = async {
            queue_terminal_stream_handshake_frame(&terminal_tx)?;
            let mut request = tonic::Request::new(ReceiverStream::new(terminal_rx));
            insert_bearer_metadata(request.metadata_mut(), &config.token)?;
            let response = tokio::select! {
                changed = stop_rx.changed() => {
                    if changed.is_err() || *stop_rx.borrow() {
                        return Ok(());
                    }
                    return Ok(());
                }
                response = client.agent_terminal_connect(request) => {
                    response.map_err(|error| {
                        format_gateway_terminal_stream_rpc_error("open", &error, &config)
                    })?
                }
            };
            self.set_terminal_stream_sender(Some(terminal_tx.clone()));
            let mut inbound = response.into_inner();
            let mut keepalive = tokio::time::interval(GATEWAY_TERMINAL_STREAM_KEEPALIVE_INTERVAL);
            keepalive.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            keepalive.tick().await;
            loop {
                tokio::select! {
                    changed = stop_rx.changed() => {
                        if changed.is_err() || *stop_rx.borrow() {
                            return Ok(());
                        }
                    }
                    _ = keepalive.tick() => {
                        queue_terminal_stream_keepalive_frame(&terminal_tx).await?;
                    }
                    message = inbound.message() => {
                        match message {
                            Ok(Some(frame)) => {
                                if let Err(error) = self.handle_terminal_stream_frame(frame).await {
                                    eprintln!("handle gateway terminal stream frame failed: {error}");
                                }
                            }
                            Ok(None) => return Ok(()),
                            Err(error) => {
                                return Err(format_gateway_terminal_stream_rpc_error("receive", &error, &config))
                            }
                        }
                    }
                }
            }
        }
        .await;

        self.clear_terminal_stream_sender_if_current(&terminal_tx);
        result
    }

    pub(crate) async fn handle_terminal_stream_frame(
        &self,
        frame: proto::TerminalStreamFrame,
    ) -> Result<(), String> {
        let kind = frame.kind.trim().to_ascii_lowercase();
        let stream_id = frame.stream_id.clone();
        let session_id = frame.session_id.clone();
        let project_path_key = frame.project_path_key.clone();
        let result = match kind.as_str() {
            "attach" => {
                self.ensure_terminal_stream_allowed(&frame)?;
                let snapshot = self.terminal_registry.stream_attach(
                    frame.session_id.clone(),
                    optional_proto_usize(frame.max_bytes),
                )?;
                self.send_terminal_stream_frame(terminal_stream_snapshot_to_proto(
                    stream_id.clone(),
                    snapshot,
                ))
                .await
            }
            "input" => {
                self.ensure_terminal_stream_allowed(&frame)?;
                self.terminal_registry
                    .input_bytes_from_remote(frame.session_id.clone(), frame.data.clone())?;
                Ok(())
            }
            "resize" => {
                self.ensure_terminal_stream_allowed(&frame)?;
                self.terminal_registry.stream_resize(
                    frame.session_id.clone(),
                    optional_proto_u16(frame.cols).unwrap_or(80),
                    optional_proto_u16(frame.rows).unwrap_or(24),
                )?;
                Ok(())
            }
            "detach" => Ok(()),
            "" => Err("terminal stream frame kind is required".to_string()),
            other => Err(format!("unsupported terminal stream frame: {other}")),
        };

        if let Err(error) = result {
            let _ = self
                .send_terminal_stream_frame(terminal_stream_error_frame(
                    stream_id,
                    session_id,
                    project_path_key,
                    error.clone(),
                ))
                .await;
            return Err(error);
        }
        Ok(())
    }

    pub(crate) async fn send_terminal_stream_frame(
        &self,
        frame: proto::TerminalStreamFrame,
    ) -> Result<(), String> {
        let sender = self.current_terminal_stream_sender()?;
        sender
            .send(frame)
            .await
            .map_err(|error| format!("send terminal stream frame failed: {error}"))
    }

    pub(crate) async fn handle_terminal_request(
        &self,
        request: proto::TerminalRequest,
    ) -> Result<proto::TerminalResponse, String> {
        let action = request.action.trim().to_ascii_lowercase();
        self.ensure_terminal_request_allowed(&action, &request)?;
        match action.as_str() {
            "shell_options" => {
                let options = terminal_shell_options();
                Ok(proto::TerminalResponse {
                    action,
                    sessions: Vec::new(),
                    session: None,
                    output: Vec::new(),
                    truncated: false,
                    shell_options: options
                        .options
                        .into_iter()
                        .map(terminal_shell_option_to_proto)
                        .collect(),
                    default_shell: options.default_shell,
                    output_start_offset: 0,
                    output_end_offset: 0,
                    ssh_prompt: None,
                    latency_ms: 0,
                    ssh_tabs: None,
                })
            }
            "list" => {
                let project_path_key = normalize_project_path_key(&request.project_path_key);
                let project_filter = (!project_path_key.is_empty()).then_some(project_path_key);
                let config = self.config_tx.borrow().clone();
                let sessions = self
                    .terminal_registry
                    .list(project_filter)
                    .sessions
                    .into_iter()
                    .filter(|session| {
                        if session.kind.trim() == "ssh" {
                            config.enable_web_ssh_terminal
                        } else {
                            config.enable_web_terminal
                        }
                    })
                    .map(terminal_session_to_proto)
                    .collect();
                Ok(proto::TerminalResponse {
                    action,
                    sessions,
                    session: None,
                    output: Vec::new(),
                    truncated: false,
                    shell_options: Vec::new(),
                    default_shell: String::new(),
                    output_start_offset: 0,
                    output_end_offset: 0,
                    ssh_prompt: None,
                    latency_ms: 0,
                    ssh_tabs: None,
                })
            }
            "create" => {
                let project_path_key =
                    required_terminal_project_path_key(&request.project_path_key)?;
                let snapshot = self.terminal_registry.create(
                    request.cwd,
                    Some(project_path_key),
                    optional_proto_text(request.shell),
                    optional_proto_text(request.title),
                    optional_proto_u16(request.cols),
                    optional_proto_u16(request.rows),
                )?;
                Ok(terminal_create_snapshot_response_to_proto(action, snapshot))
            }
            "create_ssh" => {
                let project_path_key =
                    required_terminal_project_path_key(&request.project_path_key)?;
                let response = self
                    .terminal_registry
                    .clone()
                    .create_ssh(
                        request.cwd,
                        Some(project_path_key),
                        request.ssh_host_id,
                        optional_proto_text(request.title),
                        optional_proto_u16(request.cols),
                        optional_proto_u16(request.rows),
                        request.sftp_enabled,
                    )
                    .await?;
                Ok(terminal_ssh_create_response_to_proto(action, response))
            }
            "answer_ssh_prompt" => {
                let response = self
                    .terminal_registry
                    .clone()
                    .answer_ssh_prompt(
                        request.prompt_id,
                        optional_proto_text(request.prompt_answer),
                        request.trust_host_key,
                    )
                    .await?;
                Ok(terminal_ssh_create_response_to_proto(action, response))
            }
            "ssh_latency" => {
                self.ensure_terminal_session_in_project(
                    &request.session_id,
                    &request.project_path_key,
                )?;
                let latency = self
                    .terminal_registry
                    .ssh_latency(request.session_id)
                    .await?;
                Ok(proto::TerminalResponse {
                    action,
                    sessions: Vec::new(),
                    session: None,
                    output: Vec::new(),
                    truncated: false,
                    shell_options: Vec::new(),
                    default_shell: String::new(),
                    output_start_offset: 0,
                    output_end_offset: 0,
                    ssh_prompt: None,
                    latency_ms: latency.latency_ms,
                    ssh_tabs: None,
                })
            }
            "cancel_ssh_prompt" => {
                self.terminal_registry
                    .cancel_ssh_prompt(request.prompt_id)?;
                Ok(proto::TerminalResponse {
                    action,
                    sessions: Vec::new(),
                    session: None,
                    output: Vec::new(),
                    truncated: false,
                    shell_options: Vec::new(),
                    default_shell: String::new(),
                    output_start_offset: 0,
                    output_end_offset: 0,
                    ssh_prompt: None,
                    latency_ms: 0,
                    ssh_tabs: None,
                })
            }
            "ssh_tabs_list" => {
                let project_path_key =
                    required_terminal_project_path_key(&request.project_path_key)?;
                let snapshot = self
                    .terminal_registry
                    .ssh_terminal_tabs_list(project_path_key)?;
                Ok(terminal_ssh_tabs_response_to_proto(action, snapshot))
            }
            "ssh_tab_open" => {
                let snapshot = self
                    .terminal_registry
                    .ssh_terminal_tab_open(request.session_id, request.tab_kind)?;
                Ok(terminal_ssh_tabs_response_to_proto(action, snapshot))
            }
            "ssh_tab_close" => {
                let snapshot = self
                    .terminal_registry
                    .ssh_terminal_tab_close(request.tab_id)?;
                Ok(terminal_ssh_tabs_response_to_proto(action, snapshot))
            }
            "rename" => {
                self.ensure_terminal_session_in_project(
                    &request.session_id,
                    &request.project_path_key,
                )?;
                let session = self
                    .terminal_registry
                    .rename(request.session_id, request.title)?;
                Ok(terminal_record_response_to_proto(action, session))
            }
            "close" => {
                self.ensure_terminal_session_in_project(
                    &request.session_id,
                    &request.project_path_key,
                )?;
                let session = self.terminal_registry.close(request.session_id)?;
                self.sftp_registry.close_session(&session.id);
                Ok(terminal_record_response_to_proto(action, session))
            }
            "close_project" => {
                let project_path_key =
                    required_terminal_project_path_key(&request.project_path_key)?;
                let config = self.config_tx.borrow().clone();
                let sessions: Vec<TerminalSessionRecord> = self
                    .terminal_registry
                    .list(Some(project_path_key))
                    .sessions
                    .into_iter()
                    .filter(|session| {
                        if session.kind.trim() == "ssh" {
                            config.enable_web_ssh_terminal
                        } else {
                            config.enable_web_terminal
                        }
                    })
                    .filter_map(|session| self.terminal_registry.close(session.id).ok())
                    .collect();
                for session in &sessions {
                    self.sftp_registry.close_session(&session.id);
                }
                Ok(terminal_list_response_to_proto(action, sessions))
            }
            "" => Err("terminal action is required".to_string()),
            other => Err(format!("unsupported terminal action: {other}")),
        }
    }

    pub(crate) fn ensure_terminal_session_in_project(
        &self,
        session_id: &str,
        project_path_key: &str,
    ) -> Result<(), String> {
        let project_path_key = required_terminal_project_path_key(project_path_key)?;
        let session = self
            .terminal_registry
            .session_record(session_id.trim().to_string())?;
        if !project_path_keys_equal(&session.project_path_key, &project_path_key) {
            return Err("terminal session is outside the requested project".to_string());
        }
        Ok(())
    }

    pub(crate) fn ensure_terminal_request_allowed(
        &self,
        action: &str,
        request: &proto::TerminalRequest,
    ) -> Result<(), String> {
        let config = self.config_tx.borrow().clone();
        match action {
            "create_ssh" | "answer_ssh_prompt" | "cancel_ssh_prompt" | "ssh_tabs_list"
            | "ssh_tab_open" | "ssh_tab_close" => {
                if config.enable_web_ssh_terminal {
                    Ok(())
                } else {
                    Err("web SSH terminal is disabled in desktop Remote settings".to_string())
                }
            }
            "list" => {
                if config.enable_web_terminal || config.enable_web_ssh_terminal {
                    Ok(())
                } else {
                    Err("web terminal is disabled in desktop Remote settings".to_string())
                }
            }
            "attach" | "input" | "resize" | "rename" | "close" | "ssh_latency" => {
                let session = self
                    .terminal_registry
                    .session_record(request.session_id.trim().to_string())?;
                let allowed = if session.kind.trim() == "ssh" {
                    config.enable_web_ssh_terminal
                } else {
                    config.enable_web_terminal
                };
                if allowed {
                    Ok(())
                } else if session.kind.trim() == "ssh" {
                    Err("web SSH terminal is disabled in desktop Remote settings".to_string())
                } else {
                    Err("web terminal is disabled in desktop Remote settings".to_string())
                }
            }
            "close_project" => {
                if config.enable_web_terminal || config.enable_web_ssh_terminal {
                    Ok(())
                } else {
                    Err("web terminal is disabled in desktop Remote settings".to_string())
                }
            }
            _ => {
                if config.enable_web_terminal {
                    Ok(())
                } else {
                    Err("web terminal is disabled in desktop Remote settings".to_string())
                }
            }
        }
    }

    pub(crate) fn ensure_terminal_stream_allowed(
        &self,
        frame: &proto::TerminalStreamFrame,
    ) -> Result<(), String> {
        let action = frame.kind.trim().to_ascii_lowercase();
        let request = proto::TerminalRequest {
            action: action.clone(),
            session_id: frame.session_id.clone(),
            project_path_key: frame.project_path_key.clone(),
            cols: frame.cols,
            rows: frame.rows,
            max_bytes: frame.max_bytes,
            ..Default::default()
        };
        match action.as_str() {
            "attach" | "input" | "resize" => {
                self.ensure_terminal_session_in_project(
                    &request.session_id,
                    &request.project_path_key,
                )?;
                self.ensure_terminal_request_allowed(&action, &request)
            }
            other => Err(format!("unsupported terminal stream frame: {other}")),
        }
    }
}

pub(crate) fn required_terminal_project_path_key(value: &str) -> Result<String, String> {
    let project_path_key = normalize_project_path_key(value);
    if project_path_key.is_empty() {
        return Err("project_path_key is required".to_string());
    }
    Ok(project_path_key)
}

pub(crate) fn terminal_u128_to_u64(value: u128) -> u64 {
    value.min(u128::from(u64::MAX)) as u64
}

pub(crate) fn terminal_session_to_proto(session: TerminalSessionRecord) -> proto::TerminalSession {
    proto::TerminalSession {
        id: session.id,
        project_path_key: normalize_project_path_key(&session.project_path_key),
        cwd: session.cwd,
        shell: session.shell,
        title: session.title,
        pid: session.pid.unwrap_or_default(),
        cols: u32::from(session.cols),
        rows: u32::from(session.rows),
        created_at: terminal_u128_to_u64(session.created_at),
        updated_at: terminal_u128_to_u64(session.updated_at),
        finished_at: session
            .finished_at
            .map(terminal_u128_to_u64)
            .unwrap_or_default(),
        exit_code: session.exit_code.unwrap_or_default(),
        running: session.running,
        kind: if session.kind.trim() == "ssh" {
            "ssh".to_string()
        } else {
            "local".to_string()
        },
        ssh: session.ssh.map(|ssh| proto::TerminalSshMetadata {
            host_id: ssh.host_id,
            host_name: ssh.host_name,
            username: ssh.username,
            host: ssh.host,
            port: u32::from(ssh.port),
            auth_type: ssh.auth_type,
            status: ssh.status,
            reconnect_attempt: u32::from(ssh.reconnect_attempt),
            reconnect_max_attempts: u32::from(ssh.reconnect_max_attempts),
            sftp_enabled: ssh.sftp_enabled,
        }),
    }
}

pub(crate) fn terminal_shell_option_to_proto(
    option: TerminalShellOption,
) -> proto::TerminalShellOption {
    proto::TerminalShellOption {
        id: option.id,
        label: option.label,
        command: option.command,
    }
}

pub(crate) fn terminal_list_response_to_proto(
    action: String,
    sessions: Vec<TerminalSessionRecord>,
) -> proto::TerminalResponse {
    proto::TerminalResponse {
        action,
        sessions: sessions
            .into_iter()
            .map(terminal_session_to_proto)
            .collect(),
        session: None,
        output: Vec::new(),
        truncated: false,
        shell_options: Vec::new(),
        default_shell: String::new(),
        output_start_offset: 0,
        output_end_offset: 0,
        ssh_prompt: None,
        latency_ms: 0,
        ssh_tabs: None,
    }
}

pub(crate) fn terminal_record_response_to_proto(
    action: String,
    session: TerminalSessionRecord,
) -> proto::TerminalResponse {
    proto::TerminalResponse {
        action,
        sessions: Vec::new(),
        session: Some(terminal_session_to_proto(session)),
        output: Vec::new(),
        truncated: false,
        shell_options: Vec::new(),
        default_shell: String::new(),
        output_start_offset: 0,
        output_end_offset: 0,
        ssh_prompt: None,
        latency_ms: 0,
        ssh_tabs: None,
    }
}

pub(crate) fn terminal_create_snapshot_response_to_proto(
    action: String,
    snapshot: TerminalSnapshotResponse,
) -> proto::TerminalResponse {
    proto::TerminalResponse {
        action,
        sessions: Vec::new(),
        session: Some(terminal_session_to_proto(snapshot.session)),
        output: snapshot.output_bytes,
        truncated: snapshot.truncated,
        shell_options: Vec::new(),
        default_shell: String::new(),
        output_start_offset: snapshot.output_start_offset,
        output_end_offset: snapshot.output_end_offset,
        ssh_prompt: None,
        latency_ms: 0,
        ssh_tabs: None,
    }
}

pub(crate) fn terminal_ssh_create_response_to_proto(
    action: String,
    response: TerminalSshCreateResponse,
) -> proto::TerminalResponse {
    proto::TerminalResponse {
        action,
        sessions: Vec::new(),
        session: response.session.map(terminal_session_to_proto),
        output: response.output_bytes,
        truncated: response.truncated,
        shell_options: Vec::new(),
        default_shell: String::new(),
        output_start_offset: response.output_start_offset,
        output_end_offset: response.output_end_offset,
        ssh_prompt: response.ssh_prompt.map(|prompt| proto::TerminalSshPrompt {
            id: prompt.id,
            kind: prompt.kind,
            host_id: prompt.host_id,
            host_name: prompt.host_name,
            host: prompt.host,
            port: u32::from(prompt.port),
            message: prompt.message,
            fingerprint_sha256: prompt.fingerprint_sha256,
            key_type: prompt.key_type,
            answer_echo: prompt.answer_echo,
        }),
        latency_ms: 0,
        ssh_tabs: None,
    }
}

pub(crate) fn terminal_ssh_tabs_response_to_proto(
    action: String,
    snapshot: SshTerminalTabsSnapshot,
) -> proto::TerminalResponse {
    proto::TerminalResponse {
        action,
        sessions: Vec::new(),
        session: None,
        output: Vec::new(),
        truncated: false,
        shell_options: Vec::new(),
        default_shell: String::new(),
        output_start_offset: 0,
        output_end_offset: 0,
        ssh_prompt: None,
        latency_ms: 0,
        ssh_tabs: Some(ssh_terminal_tabs_to_proto(snapshot)),
    }
}

pub(crate) fn terminal_stream_snapshot_to_proto(
    stream_id: String,
    snapshot: TerminalStreamSnapshotResponse,
) -> proto::TerminalStreamFrame {
    let project_path_key = normalize_project_path_key(&snapshot.session.project_path_key);
    let session_id = snapshot.session.id.clone();
    proto::TerminalStreamFrame {
        kind: "snapshot".to_string(),
        stream_id,
        session_id,
        project_path_key,
        seq: 0,
        start_offset: snapshot.output_start_offset,
        end_offset: snapshot.output_end_offset,
        cols: u32::from(snapshot.session.cols),
        rows: u32::from(snapshot.session.rows),
        max_bytes: 0,
        truncated: snapshot.truncated,
        error: String::new(),
        session: Some(terminal_session_to_proto(snapshot.session)),
        data: snapshot.bytes,
    }
}

pub(crate) fn build_terminal_stream_output_frame(
    payload: TerminalStreamEventPayload,
) -> proto::TerminalStreamFrame {
    proto::TerminalStreamFrame {
        kind: payload.kind,
        stream_id: String::new(),
        session_id: payload.session_id,
        project_path_key: normalize_project_path_key(&payload.project_path_key),
        seq: 0,
        start_offset: payload.start_offset,
        end_offset: payload.end_offset,
        cols: 0,
        rows: 0,
        max_bytes: 0,
        truncated: false,
        error: String::new(),
        session: None,
        data: payload.bytes,
    }
}

pub(crate) fn terminal_stream_error_frame(
    stream_id: String,
    session_id: String,
    project_path_key: String,
    error: String,
) -> proto::TerminalStreamFrame {
    proto::TerminalStreamFrame {
        kind: "error".to_string(),
        stream_id,
        session_id,
        project_path_key: normalize_project_path_key(&project_path_key),
        seq: 0,
        start_offset: 0,
        end_offset: 0,
        cols: 0,
        rows: 0,
        max_bytes: 0,
        truncated: false,
        error,
        session: None,
        data: Vec::new(),
    }
}

pub(crate) fn ssh_terminal_tab_to_proto(tab: SshTerminalTabRecord) -> proto::TerminalSshTab {
    proto::TerminalSshTab {
        id: tab.id,
        session_id: tab.session_id,
        project_path_key: normalize_project_path_key(&tab.project_path_key),
        kind: tab.kind,
        created_at: tab.created_at as u64,
        updated_at: tab.updated_at as u64,
    }
}

pub(crate) fn ssh_terminal_tabs_to_proto(
    snapshot: SshTerminalTabsSnapshot,
) -> proto::TerminalSshTabsSnapshot {
    proto::TerminalSshTabsSnapshot {
        project_path_key: normalize_project_path_key(&snapshot.project_path_key),
        tabs: snapshot
            .tabs
            .into_iter()
            .map(ssh_terminal_tab_to_proto)
            .collect(),
        revision: snapshot.revision,
    }
}

pub(crate) fn build_terminal_event_envelope(payload: TerminalEventPayload) -> proto::AgentEnvelope {
    proto::AgentEnvelope {
        request_id: format!("terminal-event-{}", Uuid::new_v4()),
        timestamp: now_unix_seconds(),
        payload: Some(proto::agent_envelope::Payload::TerminalEvent(
            proto::TerminalEvent {
                kind: payload.kind,
                session_id: payload.session_id,
                project_path_key: normalize_project_path_key(&payload.project_path_key),
                session: payload.session.map(terminal_session_to_proto),
                data: payload.data.unwrap_or_default(),
                output_start_offset: payload.output_start_offset.unwrap_or_default(),
                output_end_offset: payload.output_end_offset.unwrap_or_default(),
                ssh_tabs: payload.ssh_tabs.map(ssh_terminal_tabs_to_proto),
            },
        )),
    }
}

pub(crate) fn queue_terminal_stream_handshake_frame(
    sender: &mpsc::Sender<proto::TerminalStreamFrame>,
) -> Result<(), String> {
    // Some HTTP/2 proxies do not fully establish a bidi stream until the client
    // sends its first DATA frame. `detach` is a gateway no-op and is not forwarded
    // to browser terminal subscribers.
    sender
        .try_send(terminal_stream_noop_frame("desktop-handshake"))
        .map_err(|error| format!("queue gateway terminal stream handshake failed: {error}"))
}

pub(crate) async fn queue_terminal_stream_keepalive_frame(
    sender: &mpsc::Sender<proto::TerminalStreamFrame>,
) -> Result<(), String> {
    sender
        .send(terminal_stream_noop_frame("desktop-keepalive"))
        .await
        .map_err(|error| format!("queue gateway terminal stream keepalive failed: {error}"))
}

pub(crate) fn terminal_stream_noop_frame(prefix: &str) -> proto::TerminalStreamFrame {
    proto::TerminalStreamFrame {
        kind: "detach".to_string(),
        stream_id: format!("{}-{}", prefix.trim(), Uuid::new_v4()),
        ..Default::default()
    }
}

pub(crate) fn format_gateway_terminal_stream_rpc_error(
    phase: &str,
    error: &tonic::Status,
    config: &RemoteSettingsPayload,
) -> String {
    let message = error.to_string();
    if !is_h2_protocol_error(&message) {
        return format!("gateway terminal stream {phase} failed: {message}");
    }

    let endpoint = build_grpc_url(config).unwrap_or_else(|_| "invalid endpoint".to_string());
    format!(
        "gateway terminal stream {phase} failed: {message}. \
         The gateway terminal stream requires a gRPC endpoint that supports HTTP/2 bidi streams; \
         check Remote gRPC Endpoint / gRPC port. Current endpoint: {endpoint}"
    )
}
