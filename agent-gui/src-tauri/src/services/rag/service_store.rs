use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

use crate::commands::settings;

use super::{RagAccessMode, RagCapabilities, RagError, RagServiceConfig};

const RAG_STORE_ERROR: &str = "RAG_STORE_ERROR";

/// 持久化不含密钥的 RAG 服务配置。
pub struct RagServiceStore {
    connection: Mutex<Connection>,
}

impl RagServiceStore {
    /// 打开 Agent 设置数据库中的 RAG 服务仓储。
    pub fn open() -> Result<Self, RagError> {
        let connection = settings::open_db().map_err(store_error)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    /// 创建仅供测试使用的内存仓储。
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, RagError> {
        let connection = Connection::open_in_memory().map_err(store_error)?;
        settings::initialize_schema(&connection).map_err(store_error)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    #[cfg(test)]
    pub(crate) fn overwrite_json_for_test(
        &self,
        service_id: &str,
        column: &str,
        value: &str,
    ) -> Result<(), RagError> {
        let column = match column {
            "capabilities_snapshot_json" => "capabilities_snapshot_json",
            "agent_knowledge_base_ids_json" => "agent_knowledge_base_ids_json",
            _ => {
                return Err(RagError::new(
                    RAG_STORE_ERROR,
                    "unsupported test JSON column",
                ))
            }
        };
        let connection = self.lock_connection()?;
        connection
            .execute(
                &format!("UPDATE rag_services SET {column} = ?1 WHERE service_id = ?2"),
                params![value, service_id],
            )
            .map(|_| ())
            .map_err(store_error)
    }

    /// 保存服务配置；新默认服务会在同一事务中清除旧默认标记。
    pub fn save(&self, service: &RagServiceConfig) -> Result<(), RagError> {
        let mut connection = self.lock_connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;

        if service.is_default {
            transaction
                .execute(
                    "UPDATE rag_services SET is_default = 0 WHERE is_default = 1 AND service_id <> ?1",
                    params![service.id],
                )
                .map_err(store_error)?;
        }

        let knowledge_base_ids_json =
            serde_json::to_string(&service.agent_knowledge_base_ids).map_err(store_error)?;
        let capabilities_snapshot_json = service
            .capabilities_snapshot
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(store_error)?;
        let timeout_ms = i64::try_from(service.timeout_ms)
            .map_err(|_| RagError::new(RAG_STORE_ERROR, "RAG 服务超时配置超过本地存储范围"))?;

        transaction
            .execute(
                "
                INSERT INTO rag_services (
                    service_id, name, adapter_type, base_url, enabled, is_default,
                    agent_enabled, agent_knowledge_base_ids_json, timeout_ms,
                    management_credential_configured, agent_credential_configured,
                    capabilities_snapshot_json, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                ON CONFLICT(service_id) DO UPDATE SET
                    name = excluded.name,
                    adapter_type = excluded.adapter_type,
                    base_url = excluded.base_url,
                    enabled = excluded.enabled,
                    is_default = excluded.is_default,
                    agent_enabled = excluded.agent_enabled,
                    agent_knowledge_base_ids_json = excluded.agent_knowledge_base_ids_json,
                    timeout_ms = excluded.timeout_ms,
                    management_credential_configured = excluded.management_credential_configured,
                    agent_credential_configured = excluded.agent_credential_configured,
                    capabilities_snapshot_json = excluded.capabilities_snapshot_json,
                    updated_at = excluded.updated_at
                ",
                params![
                    service.id,
                    service.name,
                    service.adapter_type,
                    service.base_url,
                    bool_to_integer(service.enabled),
                    bool_to_integer(service.is_default),
                    bool_to_integer(service.agent_enabled),
                    knowledge_base_ids_json,
                    timeout_ms,
                    bool_to_integer(service.management_credential_configured),
                    bool_to_integer(service.agent_credential_configured),
                    capabilities_snapshot_json,
                    now_ms(),
                ],
            )
            .map_err(store_error)?;

        transaction.commit().map_err(store_error)
    }

    /// 按服务标识读取配置。
    pub fn get(&self, service_id: &str) -> Result<Option<RagServiceConfig>, RagError> {
        let connection = self.lock_connection()?;
        let sql = select_services_sql("WHERE service_id = ?1");
        connection
            .query_row(&sql, params![service_id], map_service_row)
            .optional()
            .map_err(store_error)
    }

    /// 按更新时间和标识稳定列出全部服务。
    pub fn list(&self) -> Result<Vec<RagServiceConfig>, RagError> {
        let connection = self.lock_connection()?;
        let sql = select_services_sql("ORDER BY updated_at ASC, service_id ASC");
        let mut statement = connection.prepare(&sql).map_err(store_error)?;
        let rows = statement
            .query_map([], map_service_row)
            .map_err(store_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(store_error)
    }

    /// 删除服务配置，不自动选择新的默认服务。
    pub fn delete(&self, service_id: &str) -> Result<bool, RagError> {
        let connection = self.lock_connection()?;
        connection
            .execute(
                "DELETE FROM rag_services WHERE service_id = ?1",
                params![service_id],
            )
            .map(|affected| affected > 0)
            .map_err(store_error)
    }

    pub fn resolve(
        &self,
        service_id: Option<&str>,
        access_mode: RagAccessMode,
    ) -> Result<RagServiceConfig, RagError> {
        let service = match service_id.map(str::trim).filter(|id| !id.is_empty()) {
            Some(id) => self.get(id)?,
            None => {
                let services = self.list()?;
                if let Some(default) = services.iter().find(|item| item.is_default) {
                    Some(default.clone())
                } else {
                    let mut eligible = services.into_iter().filter(|item| {
                        item.enabled && (access_mode != RagAccessMode::Agent || item.agent_enabled)
                    });
                    let service = eligible.next();
                    if service.is_some() && eligible.next().is_some() {
                        return Err(RagError::new(
                            "RAG_SERVICE_NOT_FOUND",
                            "存在多个可用的 RAG 服务，请显式指定 service_id 或设置默认服务",
                        ));
                    }
                    service
                }
            }
        }
        .ok_or_else(|| RagError::new("RAG_SERVICE_NOT_FOUND", "未找到可用的 RAG 服务"))?;

        if !service.enabled {
            return Err(RagError::new("RAG_SERVICE_DISABLED", "RAG 服务已禁用"));
        }
        if access_mode == RagAccessMode::Agent && !service.agent_enabled {
            return Err(RagError::new(
                "RAG_AGENT_ACCESS_DISABLED",
                "RAG 服务未向 Agent 开放",
            ));
        }
        Ok(service)
    }

    fn lock_connection(&self) -> Result<MutexGuard<'_, Connection>, RagError> {
        self.connection
            .lock()
            .map_err(|_| RagError::new(RAG_STORE_ERROR, "RAG 服务配置仓储暂时不可用"))
    }
}

fn select_services_sql(suffix: &str) -> String {
    format!(
        "
        SELECT service_id, name, adapter_type, base_url, enabled, is_default,
               agent_enabled, agent_knowledge_base_ids_json, timeout_ms,
               management_credential_configured, agent_credential_configured,
               capabilities_snapshot_json
        FROM rag_services
        {suffix}
        "
    )
}

fn map_service_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RagServiceConfig> {
    let knowledge_base_ids_json: String = row.get(7)?;
    let capabilities_snapshot_json: Option<String> = row.get(11)?;
    let agent_knowledge_base_ids =
        serde_json::from_str(&knowledge_base_ids_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                knowledge_base_ids_json.len(),
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    let capabilities_snapshot: Option<RagCapabilities> =
        capabilities_snapshot_json.and_then(|json| serde_json::from_str(&json).ok());
    let timeout_ms: i64 = row.get(8)?;

    Ok(RagServiceConfig {
        id: row.get(0)?,
        name: row.get(1)?,
        adapter_type: row.get(2)?,
        base_url: row.get(3)?,
        enabled: integer_to_bool(row.get(4)?),
        is_default: integer_to_bool(row.get(5)?),
        agent_enabled: integer_to_bool(row.get(6)?),
        agent_knowledge_base_ids,
        timeout_ms: u64::try_from(timeout_ms).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                8,
                rusqlite::types::Type::Integer,
                Box::new(error),
            )
        })?,
        management_credential_configured: integer_to_bool(row.get(9)?),
        agent_credential_configured: integer_to_bool(row.get(10)?),
        capabilities_snapshot,
    })
}

fn bool_to_integer(value: bool) -> i64 {
    i64::from(value)
}

fn integer_to_bool(value: i64) -> bool {
    value != 0
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis() as i64
}

fn store_error(error: impl std::fmt::Display) -> RagError {
    RagError::new(RAG_STORE_ERROR, format!("RAG 服务配置操作失败：{error}"))
}
