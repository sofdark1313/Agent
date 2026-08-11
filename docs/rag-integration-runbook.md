# 内置 RAG 集成运行手册

## 1. 架构边界

Agent 的 RAG 功能是原生内置客户端，不派生 MCP Server，也不通过 MCP 注册、发现或转发 RAG 工具。

调用链为：

```text
RAG Hub / RagListKnowledgeBases / RagSearch
                    ↓ Tauri command
           Rust RagGatewayService
                    ↓ HTTPS/HTTP(localhost)
        RAGent /api/external/v1/*
```

Agent 负责多服务配置、系统凭证存储、能力协商、管理界面和只读 Agent 工具；它不会启动、停止或部署 RAGent。RAGent 仍是独立进程，并按其部署配置使用 PostgreSQL、Redis、对象存储、RocketMQ、向量库和 AI Provider。

## 2. 前置条件

- RAGent 已启动，默认地址为 `http://localhost:9090/api/ragent`。
- 数据库迁移已包含外部 API Key 和外部入库任务表。
- 已创建一把 `management` Key。若要向 Agent 开放只读工具，再创建一把 `agent` Key。
- 操作系统凭证库可用。Agent 不会把 Key 明文降级保存到 SQLite、浏览器存储或日志。
- 非本机地址应使用 HTTPS；明文 HTTP 只允许 localhost/loopback。

## 3. API Key 建议

管理 Key 用于 RAG Hub 的知识库、文档、入库和检索实验室，建议权限为：

```text
audience: management
scopes: knowledge:read, knowledge:write, ingestion:write,
        retrieval:execute, rerank:execute
knowledgeBaseIds: 实际需要管理的 ID，或管理员明确授权的 *
```

Agent Key 只用于内置工具，建议最小权限为：

```text
audience: agent
scopes: knowledge:read, retrieval:execute
knowledgeBaseIds: 只列出允许 Agent 检索的知识库 ID
```

不要给 Agent Key 授予写权限。服务端还会校验 audience，Agent Key 即使误配写 scope 也不能执行管理写操作。

## 4. 在 Agent 中配置

1. 打开左侧 `RAG`。
2. 新增服务，适配器选择 `ragent`，Base URL 填 RAGent context path，例如 `http://localhost:9090/api/ragent`。
3. 保存非敏感配置。
4. 使用“设置管理凭证”和“设置 Agent 凭证”。凭证在 Rust 原生密码对话框中输入并直接写入系统凭证库，不进入 React state、DOM 或 IPC payload。
5. 执行连接测试。连接测试先匿名读取 `/api/external/v1/health`，随后分别使用管理凭证和 Agent 凭证读取 `/api/external/v1/capabilities`，校验 audience、协议与能力，并保存带本地采集时间的能力快照。
6. 如需启用 Agent 工具，开启“允许 Agent 使用”，选择知识库白名单，并确保 Agent 凭证、协议版本和能力快照均有效。
7. 多服务场景下设置一个默认服务；工具参数也可显式选择服务。多个可用服务但没有默认服务时，系统会拒绝猜选。

能力快照过期、缺失或协议不兼容时，上传、URL 导入、重排和 Agent 工具会 fail-closed；重新执行连接测试即可刷新。

## 5. 文档入库

RAG Hub 根据服务端 capabilities 动态展示和校验：

- 文件扩展名和 MIME 类型；
- 最大上传大小（本地硬上限与服务端上限取更严格值，当前均为 25 MiB）；
- `processMode`；
- `chunkStrategy` 及其 JSON Schema 参数；
- 可选 Pipeline。

上传和 URL 导入都携带独立的 `Idempotency-Key`。服务端返回独立 `jobId` 与 `documentId`，界面按 `jobId` 轮询：

```text
PENDING → RUNNING → SUCCEEDED
                  ↘ FAILED（仅 retryable=true 时允许重试）
```

重试会创建子 Job，并保留父 Job 历史；不会把 `documentId` 当作任务 ID。删除文档前必须确认没有活动任务。

页面刷新后，RAG Hub 会通过 `GET /api/external/v1/documents/{documentId}/ingestion-jobs` 恢复任务历史和最新可重试 Job，不依赖 React 内存中的临时状态。

URL 导入只允许公开 HTTP(S) 目标，服务端会对 DNS 解析结果和每次重定向执行 SSRF 校验，拒绝 loopback、私网、链路本地、保留地址和非 HTTP(S) 协议。

## 6. 检索与 Agent 工具

RAG Hub 可执行检索和独立重排实验。`topK`、`topN`、查询长度、重排开关和候选规模同时受本地安全上限与 capabilities 限制。

Agent 仅注册两个只读工具：

- `RagListKnowledgeBases`
- `RagSearch`

不会注册上传、删除、重试、知识库管理或其他写工具。工具输出中的名称、正文、metadata、warning 和错误文本均按不可信外部内容处理，执行长度限制、控制字符/双向字符清理和敏感信息脱敏。

## 7. 冒烟检查

先确认服务存活：

```powershell
Invoke-RestMethod http://localhost:9090/api/ragent/api/external/v1/health
```

再用管理 Key 检查能力：

```powershell
$headers = @{ Authorization = "Bearer <management-key>" }
Invoke-RestMethod `
  -Headers $headers `
  http://localhost:9090/api/ragent/api/external/v1/capabilities
```

预期：`protocolVersion` 为兼容的 `1.x`；`credentialAudience` 为 `management`；`limits`、`features` 和 `ingestion` 完整。然后在 RAG Hub 完成一次知识库列表、文件上传、任务终态轮询和检索。

## 8. Key 轮换

1. 在 RAGent 管理接口轮换 Key；新明文只在该次响应返回，立即保存到安全位置。
2. 在 Agent 中重新设置对应服务的管理或 Agent 凭证。
3. 重新执行连接测试，刷新 capabilities。
4. 验证 RAG Hub 或 Agent 工具。
5. 确认无旧客户端后停用旧 Key。轮换和停用使用条件更新，避免并发操作互相覆盖。

## 9. 常见故障

| 错误/现象 | 处理 |
| --- | --- |
| `RAG_CREDENTIAL_STORE_UNAVAILABLE` | 修复操作系统凭证库；系统不会降级明文保存。 |
| `RAG_AUTH_FAILED` | 检查 Key 是否正确、启用、未过期，audience/scope 是否匹配。 |
| `RAG_KB_FORBIDDEN` | 请求中至少一个知识库不在 Key 或 Agent 白名单内；整次请求会被拒绝。 |
| `RAG_PROTOCOL_MISMATCH` | 重新测试连接；检查 capabilities 是否完整、快照是否过期、协议是否为兼容 `1.x`。 |
| 上传控件不可用 | capabilities 未声明上传能力或缺少有效入库约束；先刷新连接测试。 |
| Job 长时间非终态 | 查询真实 `jobId`，检查 RAGent、RocketMQ、对象存储、向量/模型依赖和服务端日志。 |
| URL 导入被拒绝 | 目标解析到私网/保留地址、重定向越界、协议非法或内容不满足上传限制。 |

## 10. 本地验证

Agent 仓库：

```powershell
Set-Location E:\Code\Agent\agent-gui
pnpm test
pnpm build
pnpm lint
Set-Location src-tauri
cargo test --quiet
cargo check

Set-Location E:\Code\Agent
$ragRustFiles = @('agent-gui\src-tauri\src\commands\integration\rag.rs') +
  (rg --files agent-gui/src-tauri/src/services/rag -g '*.rs')
rustfmt --check --edition 2021 $ragRustFiles
```

RAGent 仓库：

```powershell
Set-Location E:\Code\RAG
mvn -pl bootstrap -am `
  "-Dsurefire.failIfNoSpecifiedTests=false" `
  "-Dspotless.apply.skip=true" test
```

仓库全量测试依赖 Redis、RocketMQ、对象存储、向量库和模型服务。若本机没有这些外部设施，必须同时记录失败的具体依赖与 RAG 外部模块聚焦回归结果，不能把基础设施连接失败描述成功能回归失败或成功。
