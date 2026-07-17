fn default_remote_grpc_port() -> u16 {
    50051
}

fn default_remote_auto_reconnect() -> bool {
    true
}

fn default_remote_heartbeat_interval() -> u64 {
    30
}

impl Default for RemoteSettingsPayload {
    fn default() -> Self {
        Self {
            enabled: false,
            gateway_url: String::new(),
            grpc_port: default_remote_grpc_port(),
            grpc_endpoint: String::new(),
            token: String::new(),
            agent_id: String::new(),
            auto_reconnect: default_remote_auto_reconnect(),
            heartbeat_interval: default_remote_heartbeat_interval(),
            enable_web_terminal: false,
            enable_web_ssh_terminal: false,
            enable_web_git: false,
            enable_web_tunnels: false,
        }
    }
}

pub(crate) fn normalize_remote_settings_payload(
    payload: RemoteSettingsPayload,
) -> RemoteSettingsPayload {
    RemoteSettingsPayload {
        enabled: payload.enabled,
        gateway_url: normalize_base_url_text(&payload.gateway_url),
        grpc_port: if payload.grpc_port == 0 {
            default_remote_grpc_port()
        } else {
            payload.grpc_port
        },
        grpc_endpoint: normalize_grpc_endpoint_text(&payload.grpc_endpoint),
        token: payload.token.trim().to_string(),
        agent_id: payload.agent_id.trim().to_string(),
        auto_reconnect: payload.auto_reconnect,
        heartbeat_interval: payload.heartbeat_interval.max(1),
        enable_web_terminal: payload.enable_web_terminal,
        enable_web_ssh_terminal: payload.enable_web_ssh_terminal,
        enable_web_git: payload.enable_web_git,
        enable_web_tunnels: payload.enable_web_tunnels,
    }
}

fn normalize_grpc_endpoint_text(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.starts_with("http:") || trimmed.starts_with("https:") {
        return normalize_base_url_text(trimmed);
    }
    trimmed.trim_end_matches('/').to_string()
}

fn normalize_base_url_text(input: &str) -> String {
    let trimmed = input.trim();
    let repaired = repair_url_scheme_slashes(trimmed);
    repaired.trim_end_matches('/').to_string()
}

fn repair_url_scheme_slashes(input: &str) -> String {
    for scheme in ["http:", "https:"] {
        if !input
            .get(..scheme.len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(scheme))
        {
            continue;
        }
        let rest = &input[scheme.len()..];
        if rest.starts_with("//") {
            return input.to_string();
        }
        return format!("{scheme}//{}", rest.trim_start_matches('/'));
    }
    input.to_string()
}

pub(crate) fn parse_remote_settings_payload(value: Value) -> Result<RemoteSettingsPayload, String> {
    let parsed = serde_json::from_value::<RemoteSettingsPayload>(value)
        .map_err(|e| format!("解析 remote settings 失败：{e}"))?;
    Ok(normalize_remote_settings_payload(parsed))
}

pub(crate) fn load_remote(conn: &Connection) -> Result<Option<Value>, String> {
    let payload_json = conn
        .query_row(
            &format!(
                "SELECT payload_json FROM {REMOTE_SETTINGS_TABLE} WHERE config_id = 'default'"
            ),
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("读取 {REMOTE_SETTINGS_TABLE} 失败：{e}"))?;

    match payload_json {
        Some(raw) => Ok(Some(parse_json(&raw, REMOTE_SETTINGS_TABLE)?)),
        None => Ok(None),
    }
}

pub(crate) fn load_remote_settings(conn: &Connection) -> Result<RemoteSettingsPayload, String> {
    match load_remote(conn)? {
        Some(value) => parse_remote_settings_payload(value),
        None => Ok(RemoteSettingsPayload::default()),
    }
}
fn redact_remote_settings(remote: Value) -> Result<Value, String> {
    let remote = expect_object(remote, "remote settings payload")?;
    let enable_web_terminal = remote
        .get("enableWebTerminal")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let enable_web_git = remote
        .get("enableWebGit")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let enable_web_ssh_terminal = remote
        .get("enableWebSshTerminal")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let enable_web_tunnels = remote
        .get("enableWebTunnels")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Ok(json!({
        "enableWebTerminal": enable_web_terminal,
        "enableWebSshTerminal": enable_web_ssh_terminal,
        "enableWebGit": enable_web_git,
        "enableWebTunnels": enable_web_tunnels,
    }))
}
fn save_remote(conn: &mut Connection, payload: Value) -> Result<(), String> {
    let normalized = parse_remote_settings_payload(payload)?;
    let payload_json = serde_json::to_value(&normalized)
        .map_err(|e| format!("序列化 {REMOTE_SETTINGS_TABLE} 失败：{e}"))?;
    let updated_at = now_ms();
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启 {REMOTE_SETTINGS_TABLE} 事务失败：{e}"))?;
    tx.execute(
        &format!("DELETE FROM {REMOTE_SETTINGS_TABLE} WHERE config_id = 'default'"),
        [],
    )
    .map_err(|e| format!("清空 {REMOTE_SETTINGS_TABLE} 失败：{e}"))?;
    tx.execute(
        &format!(
            "INSERT INTO {REMOTE_SETTINGS_TABLE} (config_id, payload_json, updated_at) VALUES ('default', ?1, ?2)"
        ),
        params![serialize_json(&payload_json, REMOTE_SETTINGS_TABLE)?, updated_at],
    )
    .map_err(|e| format!("写入 {REMOTE_SETTINGS_TABLE} 失败：{e}"))?;
    tx.commit()
        .map_err(|e| format!("提交 {REMOTE_SETTINGS_TABLE} 事务失败：{e}"))?;
    Ok(())
}
