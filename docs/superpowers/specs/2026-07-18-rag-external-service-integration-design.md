# Agent 内置 RAG 与外置服务集成设计

日期：2026-07-18

## 1. 项目背景

Agent 当前已经提供 Chat、Skills、MCP、定时任务和工作区管理能力，但缺少面向知识库的专用入口。用户需要在左侧全局导航新增“RAG”，通过配置已经运行的外置 RAG 服务完成知识库管理、文档入库、检索和重排，并让聊天 Agent 能按问题自主调用只读 RAG 能力。

首个适配目标是 `E:\Code\RAG`。该项目已经具备知识库、文档上传、异步分块、向量检索和重排能力，但尚未向 Agent 提供稳定、版本化、带服务认证的外部接口。

## 2. 已确认的产品与架构决策

- 第一版同时提供 RAG Hub 管理页面和聊天 Agent 检索能力。
- 支持配置多个外置 RAG 服务，可启用、禁用并指定一个默认服务。
- 第一版内置 `ragent` 适配器，后续通过适配器扩展其他 RAG 服务。
- RAG Hub 支持知识库管理、文档上传、URL 入库、入库状态、失败重试、文档删除和检索实验。
- Agent 根据问题自主判断是否需要 RAG，不对每轮对话强制注入检索结果。
- Agent 只获得知识库查询和检索工具，不获得上传、删除或知识库写操作。
- Agent RAG 能力作为 Agent 内置工具实现，不派生 MCP Server，也不经过 MCP Runtime。
- RAG Hub 和 Agent 内置工具共用同一个 Rust RAG 网关、服务配置和适配器。
- 外置 RAG 服务第一版只提供版本化 REST API，不增加 RAG MCP 端点。
- 管理调用和 Agent 调用使用两套独立 API Key，执行最小权限隔离。
- React 不直接请求外部 RAG 服务，也不能读取 API Key。
- `E:\Code\RAG` 的改动必须位于从 `release/1.0` 创建的独立分支 `codex/rag-external-api`。

## 3. 项目目标

1. Agent 左侧导航新增与 Chat、Skills、MCP、定时任务同级的 RAG 入口。
2. 支持配置至少两个 RAG 服务并指定默认服务。
3. 在 RAG Hub 中完成知识库、文档和入库任务管理。
4. 在 RAG Hub 中执行检索和重排实验并查看来源、分数、告警和耗时。
5. Chat Agent 可以通过内置只读工具检索被授权知识库并引用来源。
6. 外置 RAG 服务提供稳定的版本化 REST 契约、API Key 认证和数据范围控制。
7. RAG Hub 和 Agent 工具共用 Rust 网关，不复制 HTTP、认证、错误映射或响应标准化逻辑。
8. 外置 REST Controller 复用同一套 RAG 业务门面，不复制知识库、入库、检索或重排逻辑。

## 4. 非目标

第一版不包含：

- Agent 自动创建、编辑或删除知识库。
- Agent 自动上传、替换、重试或删除文档。
- Agent 每轮对话无条件执行检索。
- Agent 启动、停止或部署外置 RAG 服务。
- 将 RAG 数据库、向量库或 Java 类直接嵌入 Agent。
- 在外置 RAG 服务中实现 `/mcp/rag` 或 RAG MCP 工具。
- 第一版完整适配任意厂商的 RAG 协议。
- 跨多个 RAG 服务自动并行检索、分数归一化或结果融合。
- 对 `E:\Code\RAG` 进行与外部接入无关的大规模模块重构。

## 5. 总体架构

```text
┌──────────────────────────── Agent ────────────────────────────┐
│                                                               │
│  RAG Hub                         Chat Agent                    │
│    └── Tauri Commands              └── Built-in RAG Tools     │
│              └──────────────┬───────────────┘                 │
│                             ▼                                 │
│                    Rust RagGatewayService                     │
│                      ├── RagServiceStore                      │
│                      ├── RagCredentialStore                   │
│                      ├── RagAccessPolicy                      │
│                      ├── RagAdapterRegistry                   │
│                      └── RagResponseNormalizer                │
│                             │                                 │
└─────────────────────────────┼─────────────────────────────────┘
                              │ REST
                              ▼
┌────────────────────── External RAG Service ───────────────────┐
│  External REST Controllers                                   │
│             ▼                                                 │
│  ExternalRagService / ExternalIngestionService                │
│      ├── KnowledgeBaseService                                 │
│      ├── KnowledgeDocumentService                             │
│      ├── Ingestion Pipeline / MQ                              │
│      ├── MultiChannelRetrievalEngine                          │
│      └── RerankService                                        │
└───────────────────────────────────────────────────────────────┘
```

管理面和 Agent 调用面只在入口权限上不同，二者必须复用 Rust 网关和外部 REST 契约。

## 6. Agent 内置 RAG 工具

### 6.1 工具范围

第一版注册两个只读工具：

```text
RagListKnowledgeBases
RagSearch
```

不向 Agent 注册文档状态、独立重排或任何写工具。文档状态只服务于 RAG Hub；独立重排只用于检索实验室；正常检索由 `RagSearch` 一次完成召回、去重和可选重排。

只有至少一个服务同时满足 `enabled=true`、`agentEnabled=true`、Agent 凭证已配置且协议主版本兼容时，才注册这两个工具。禁用最后一个可用服务后，下一次工具注册刷新必须移除 RAG 工具；当前进行中的调用按调用开始时已解析的服务快照完成或返回明确错误。

### 6.2 RagListKnowledgeBases

参数：

```json
{
  "service_id": "company-rag"
}
```

`service_id` 可省略。省略时使用默认服务；如果不存在默认服务且启用了多个服务，返回明确错误，不猜测选择。

结果只包含该服务允许 Agent 访问的知识库。远端返回的知识库列表必须再次与 Agent 本地白名单求交集。

### 6.3 RagSearch

参数：

```json
{
  "service_id": "company-rag",
  "query": "员工转正后有多少天年假",
  "knowledge_base_ids": ["hr"],
  "top_k": 20,
  "rerank": {
    "enabled": true,
    "top_n": 5
  }
}
```

约束：

- `query` 必填并限制最大长度。
- `service_id` 可省略并使用默认服务。
- `knowledge_base_ids` 可省略；省略时使用该服务全部 Agent 白名单知识库。
- 请求包含任一越权知识库时 fail-closed，返回 `RAG_KB_FORBIDDEN`，不静默忽略。
- `top_k`、`top_n` 同时受本地上限和服务端 capabilities 上限约束。
- 一次调用只访问一个 RAG 服务。

工具结果包含适合模型阅读的引用文本和结构化 `details`。工具描述只包含受控文本，不直接拼接远端返回的任意描述，避免把外部内容当作工具指令。

## 7. Rust RAG 网关设计

### 7.1 组件职责

```text
RagGatewayService
├── RagServiceStore
├── RagCredentialStore
├── RagAccessPolicy
├── RagAdapterRegistry
│   └── RagentAdapter
└── RagResponseNormalizer
```

- `RagGatewayService`：解析服务、选择凭证、执行业务入口权限、调用适配器并统一响应。
- `RagServiceStore`：持久化非敏感服务配置、默认服务、启用状态、白名单和能力快照。
- `RagCredentialStore`：保存、读取、替换和删除管理凭证与 Agent 凭证。
- `RagAccessPolicy`：校验服务状态、调用方类型、知识库范围和操作权限。
- `RagAdapterRegistry`：根据 `adapterType` 选择适配器。
- `RagentAdapter`：实现首个 RAG REST 契约。
- `RagResponseNormalizer`：统一分页、错误、检索命中、任务状态和告警结构。

capabilities 快照按服务 ID 缓存并设置有限 TTL。保存服务配置、替换凭证、手动连接测试或检测到协议错误时立即失效缓存；检索结果第一版不做业务缓存。

### 7.2 适配器接口

```text
health
capabilities
listKnowledgeBases
createKnowledgeBase
updateKnowledgeBase
deleteKnowledgeBase
listDocuments
uploadDocument
importDocumentUrl
getDocument
getIngestionJob
retryIngestionJob
deleteDocument
listDocumentChunks
search
rerank
```

适配器只负责协议、鉴权头、超时、上传流和远端异常映射；默认服务选择、Agent 白名单和本地权限策略留在 `RagGatewayService`。

### 7.3 Tauri Commands

服务配置：

```text
rag_list_services
rag_save_service
rag_delete_service
rag_set_default_service
rag_test_service
```

RAG Hub 管理入口：

```text
rag_hub_list_knowledge_bases
rag_hub_create_knowledge_base
rag_hub_update_knowledge_base
rag_hub_delete_knowledge_base
rag_hub_list_documents
rag_hub_upload_document
rag_hub_import_document_url
rag_hub_get_ingestion_job
rag_hub_retry_ingestion_job
rag_hub_delete_document
rag_hub_list_document_chunks
rag_hub_search
rag_hub_rerank
```

Agent 只读入口：

```text
rag_agent_list_knowledge_bases
rag_agent_search
```

Agent 入口在 Rust 层没有任何写操作分支，不能通过构造参数升级为 Hub 权限。

## 8. 服务配置与凭证

### 8.1 前端可见配置

```json
{
  "id": "company-rag",
  "name": "公司知识库",
  "adapterType": "ragent",
  "baseUrl": "https://rag.example.com",
  "enabled": true,
  "default": true,
  "agentEnabled": true,
  "agentKnowledgeBaseIds": ["hr", "finance-policy"],
  "timeoutMs": 30000,
  "managementCredentialConfigured": true,
  "agentCredentialConfigured": true,
  "lastHealthCheck": null,
  "capabilitiesSnapshot": null
}
```

React 不得读取以下内容：

```text
managementApiKey
agentApiKey
Authorization Header
credentialRef
```

### 8.2 凭证存储

- 普通配置保存在 Agent 设置数据库的独立 `rag_services` 表。
- 管理 API Key 和 Agent API Key 保存到系统凭证库，通过 `RagCredentialStore` 访问。
- 数据库只保存是否已配置等非敏感状态，不保存明文密钥。
- 如果平台凭证库不可用，保存操作明确失败，不回退为明文 SQLite。
- 密钥更新采用 secret-update 语义，加载配置时只返回 configured 标记。
- 配置同步、导出、日志和错误信息均不得包含密钥。

### 8.3 双凭证权限

管理凭证建议范围：

```text
knowledge:read
knowledge:write
ingestion:write
retrieval:execute
rerank:execute
```

Agent 凭证建议范围：

```text
knowledge:read
retrieval:execute
```

服务端 API Key 记录还必须包含允许访问的知识库范围。Agent 本地白名单只能进一步收紧服务端范围，不能扩张。

## 9. 外置 RAG REST 与 Java 业务边界

### 9.1 分支与实施边界

在 `E:\Code\RAG` 从 `release/1.0` 创建：

```text
codex/rag-external-api
```

实现、测试和提交全部留在该分支，不改写 `release/1.0` 或 `master` 历史。

### 9.2 外部接口前缀

```text
/api/external/v1
```

第一版不增加 MCP 端点。

### 9.3 REST API 范围

```text
GET    /api/external/v1/health
GET    /api/external/v1/capabilities

GET    /api/external/v1/knowledge-bases
POST   /api/external/v1/knowledge-bases
GET    /api/external/v1/knowledge-bases/{id}
PUT    /api/external/v1/knowledge-bases/{id}
DELETE /api/external/v1/knowledge-bases/{id}

GET    /api/external/v1/knowledge-bases/{id}/documents
POST   /api/external/v1/knowledge-bases/{id}/documents/upload
POST   /api/external/v1/knowledge-bases/{id}/documents/import-url
GET    /api/external/v1/documents/{id}
DELETE /api/external/v1/documents/{id}
GET    /api/external/v1/documents/{id}/chunks

GET    /api/external/v1/ingestion-jobs/{jobId}
POST   /api/external/v1/ingestion-jobs/{jobId}/retry

POST   /api/external/v1/retrieval
POST   /api/external/v1/rerank
```

### 9.4 业务门面

外部 Controller 只负责认证、参数校验、Assembler 和响应包装。新增传输无关的业务入口：

```text
ExternalRagService
ExternalIngestionService
```

内部对象使用：

```text
KnowledgeBaseCommand / KnowledgeBaseQuery
UploadDocumentCommand
ImportDocumentUrlCommand
RetrievalQuery
RerankCommand
KnowledgeBaseDTO
DocumentDTO
IngestionJobDTO
RetrievalHitDTO
```

现有 `KnowledgeBaseService` 和 `KnowledgeDocumentService` 直接依赖 Controller Request、VO 与 `MultipartFile`。第一版允许进行与外部接入直接相关的定向解耦：Controller Request 通过 Assembler 转为业务 Command，业务服务不再新增对 Web DTO 的依赖。不得通过新 Controller 直接调用 Mapper 或复制原有业务逻辑。

## 10. 文档入库设计

### 10.1 本地文件上传

Rust 使用管理凭证流式上传文件，不将完整文件一次性加载进 React 或 Rust 内存。请求支持：

```text
file
processMode
chunkStrategy
chunkConfig
pipelineId
```

服务端处理：

1. 校验 `ingestion:write` 和知识库范围。
2. 校验文件大小、扩展名、MIME 和 capabilities 白名单。
3. 使用服务端生成的安全存储键保存源文件。
4. 在一个事务中创建文档记录和入库任务。
5. 投递现有 MQ/异步入库队列。
6. 返回 `202 Accepted`，不等待解析和向量化完成。

响应：

```json
{
  "documentId": "doc-100",
  "jobId": "job-200",
  "status": "PENDING"
}
```

### 10.2 URL 入库

URL 入库使用独立接口。服务端下载时必须：

- 只允许 `http` 和 `https`。
- 默认禁止回环、私有网络、链路本地和云元数据地址。
- 每次重定向后重新解析并校验目标地址。
- 限制下载大小、连接超时、读取超时和重定向次数。
- 校验最终响应的 MIME。
- 内网来源仅通过管理员配置的域名或 CIDR 白名单开放。

### 10.3 状态模型

文档状态：

```text
PENDING
PROCESSING
READY
FAILED
```

任务状态：

```text
PENDING
RUNNING
SUCCEEDED
FAILED
CANCELLED
```

任务阶段：

```text
VALIDATING
STORING
PARSING
CHUNKING
EMBEDDING
INDEXING
```

状态响应：

```json
{
  "jobId": "job-200",
  "documentId": "doc-100",
  "status": "RUNNING",
  "stage": "EMBEDDING",
  "progress": 65,
  "retryable": false,
  "startedAt": "2026-07-18T14:30:00+08:00",
  "error": null
}
```

第一版由 RAG Hub 轮询任务状态，不引入 SSE 或 WebSocket。轮询使用退避间隔，并在任务进入终态后停止。

### 10.4 幂等、并发与重试

- Rust 每次创建上传请求时生成 `Idempotency-Key`。
- 服务端保证同一 API Key、接口和 Idempotency-Key 不重复创建文档或任务。
- 文件 SHA-256 用于重复内容提示，不默认阻止用户创建另一个文档版本。
- 同一文档同一时间只允许一个活动入库任务。
- 重试统一从已保存源文件重新开始，不在第一版实现从失败节点恢复。
- 重试前清理残留 Chunk 和向量，创建新的 Job，并保留旧 Job 历史。

### 10.5 删除

- 文档存在活动任务时第一版拒绝删除，返回 `RAG_DOCUMENT_BUSY`。
- 删除必须清理业务记录、Chunk、向量索引和源文件。
- 清理失败时记录显式补偿任务，不能静默留下可检索的孤儿向量。

## 11. 检索与来源契约

### 11.1 检索请求

```json
{
  "query": "员工转正后有多少天年假",
  "knowledgeBaseIds": ["hr"],
  "topK": 20,
  "rerank": {
    "enabled": true,
    "topN": 5
  }
}
```

### 11.2 检索响应

```json
{
  "requestId": "rag-20260718-001",
  "results": [
    {
      "knowledgeBaseId": "hr",
      "documentId": "doc-100",
      "documentName": "员工休假管理制度.md",
      "chunkId": "chunk-103",
      "content": "员工通过试用期并完成转正后，每个自然年度享有5天带薪年假。",
      "score": 0.93,
      "source": "hybrid",
      "metadata": {
        "section": "第三章 年假"
      }
    }
  ],
  "warnings": [],
  "timings": {
    "retrievalMs": 86,
    "rerankMs": 142,
    "totalMs": 236
  }
}
```

现有 `RetrievedChunk` 只有 `id`、`text`、`score`，不足以支撑该契约。外部接入必须引入或贯穿带来源信息的 `RetrievalHitDTO`，确保通道合并、去重和重排后仍保留知识库、文档、Chunk、通道和业务元数据。Milvus、PGVector 等通道读取到的 metadata 不能在映射时丢弃。

检索实验室需要同时展示原始召回和最终重排结果；服务端响应可以包含两组结果或稳定的 rank-before/rank-after 字段，具体契约在实现计划中固定，不由前端推断。

## 12. RAG Hub 页面

### 12.1 服务页

- 查看、新增、编辑、删除、启停多个服务。
- 设置默认服务。
- 配置 Base URL、适配器、超时和接口路径覆盖。
- 分别录入或替换管理凭证与 Agent 凭证。
- 测试健康、认证、协议版本和 capabilities。
- 配置 Agent 可访问的知识库白名单。

### 12.2 知识库页

- 查询、搜索、新建、编辑和删除知识库。
- 查看文档数量、更新时间和索引状态。
- 控制知识库是否进入 Agent 本地白名单。

### 12.3 文档页

- 上传本地文件或提交 URL。
- 选择分块策略或 Pipeline。
- 查看文档状态、任务阶段和进度。
- 查看失败错误码、原因和是否可重试。
- 重试失败任务。
- 查看 Chunk。
- 删除无活动任务的文档。

### 12.4 检索实验室

- 选择服务和一个或多个知识库。
- 输入查询并设置 `topK`、重排开关和 `topN`。
- 对比原始召回和重排结果。
- 查看分数、来源、文档、Chunk、耗时和告警。
- 单独提交受限制数量和长度的候选内容进行重排测试。

## 13. 安全设计

### 13.1 API Key 服务端模型

- Key 使用高熵随机值，服务端保存 Key ID、哈希、名称、audience、权限范围、知识库范围、启用状态、过期时间和最后使用时间。
- 明文 Key 仅在创建或轮换时返回一次。
- 管理 Key 和 Agent Key 的 audience 必须不同。
- 外部接口按 scope、audience 和知识库范围共同授权。
- Key 创建、轮换、禁用和删除由 RAG 现有管理员入口或受控 CLI 完成，不由外部 API 自助提权。

### 13.2 网络与日志

- `/health` 只返回最小存活状态，不泄露版本、依赖和内部配置，可匿名访问；`/capabilities` 和全部业务接口必须认证。
- RAG Hub 连接测试需要分别使用管理凭证和 Agent 凭证验证其 audience、scope 与知识库范围，不能只验证其中一把 Key。
- 远程服务默认要求 HTTPS；仅明确的 localhost 开发地址允许 HTTP。
- HTTP Client 不得在跨 Origin 重定向时继续发送 Authorization Header。
- 限制响应体、错误体、上传体和重排候选内容大小。
- 日志不记录完整请求体、文档内容、API Key 或 Authorization Header。
- 管理写操作、认证失败和权限拒绝记录审计事件与 TraceId。

## 14. 错误处理与降级

稳定错误码至少包括：

```text
RAG_SERVICE_NOT_FOUND
RAG_SERVICE_DISABLED
RAG_AGENT_ACCESS_DISABLED
RAG_CREDENTIAL_MISSING
RAG_AUTH_FAILED
RAG_KB_FORBIDDEN
RAG_PROTOCOL_MISMATCH
RAG_REQUEST_TIMEOUT
RAG_RESPONSE_INVALID
RAG_UPLOAD_TOO_LARGE
RAG_FILE_TYPE_UNSUPPORTED
RAG_INGESTION_ALREADY_RUNNING
RAG_DOCUMENT_BUSY
RAG_DOCUMENT_PARSE_FAILED
RAG_RERANK_UNAVAILABLE
```

- 服务离线、认证失败、知识库越权和协议主版本不兼容直接失败。
- 重排失败可以降级为原始召回，但必须返回 `RAG_RERANK_UNAVAILABLE` 告警。
- 入库失败保留阶段、错误码、可重试标记和任务历史。
- 不自动切换到未授权的其他 RAG 服务。

## 15. 实施阶段

### 阶段一：外部契约、安全基线与来源模型

- 从 `release/1.0` 创建 RAG 独立分支。
- 定义 REST、错误码、capabilities、分页、入库任务和检索来源契约。
- 实现管理 Key 与 Agent Key 模型、认证过滤器、scope、audience 和知识库范围校验。
- 建立契约测试和日志脱敏测试。
- 补齐 `RetrievalHitDTO` 来源模型。

完成标志：健康、能力发现、双凭证认证和检索契约测试通过。

### 阶段二：RAG 外部业务接口与异步入库

- 建立 `ExternalRagService` 和 `ExternalIngestionService`。
- 接入知识库和文档管理。
- 接入文件上传、URL 入库、任务状态、重试、删除和 Chunk 查询。
- 接入检索和重排。
- 对修改模块执行全量 API 回归。

完成标志：第三方客户端只通过 REST 即可完成管理、入库和检索实验。

### 阶段三：Agent Rust 配置、凭证与网关

- 增加 RAG 设置模型和数据库迁移。
- 实现 `RagCredentialStore` 和双凭证 secret-update。
- 实现 `RagGatewayService`、访问策略、适配器注册和 `RagentAdapter`。
- 实现服务连接测试、能力缓存、上传流和错误映射。

完成标志：Agent 可安全保存多个服务、测试连接并通过 Rust 完成全部 RAG REST 调用。

### 阶段四：RAG Hub

- 增加左侧导航和页面路由。
- 完成服务、知识库、文档、任务进度和检索实验室页面。
- 完成空状态、加载、失败、确认、轮询和重试交互。
- 完成浅色、深色和窄窗口验证。

完成标志：用户不访问 RAG 原管理前端即可完成第一版管理操作。

### 阶段五：Agent 内置 RAG 工具

- 实现 `createRagTools()`。
- 注册 `RagListKnowledgeBases` 和 `RagSearch`。
- 接入默认服务、AgentEnabled、双凭证和知识库白名单。
- 将检索结果格式化为引用文本和结构化 details。
- 验证没有任何 RAG 写工具进入 Agent 工具列表。

完成标志：Agent 能按问题自主检索授权知识库并引用来源。

### 阶段六：联合验收

- 执行两个仓库的相关完整测试和构建。
- 完成真实文件与 URL 入库。
- 完成向量召回、重排和降级场景。
- 完成多服务、离线、错误密钥、知识库越权和版本不兼容场景。
- 整理部署、配置、密钥轮换和使用说明。

## 16. 测试计划

### 16.1 RAG 项目

- 双 API Key 创建、校验、轮换、禁用、过期、audience、scope 和知识库范围测试。
- REST Controller 参数、分页、错误码和 HTTP 状态测试。
- 业务门面与 Assembler/Convert 边界测试。
- 文件大小、扩展名、MIME 和安全存储键测试。
- URL 导入 SSRF、DNS、重定向、超时和响应大小测试。
- 上传幂等、活动任务冲突、状态流转、失败和重试测试。
- 删除及残留向量补偿测试。
- 检索来源、去重、重排和重排降级测试。
- 管理 Key 无法伪装 Agent audience，Agent Key 无法调用写接口测试。
- 日志敏感信息扫描。

### 16.2 Agent 项目

- RAG 设置默认值、数据库迁移和多服务默认选择测试。
- 两类 API Key 不回传 React、不同步、不导出测试。
- 系统凭证库不可用时拒绝明文回退测试。
- 服务 URL、TLS、重定向、超时和响应上限测试。
- Adapter 选择、capabilities 协议版本和错误映射测试。
- 文件流式上传、Idempotency-Key 和任务轮询测试。
- Rust Hub/Agent 入口权限隔离测试。
- 知识库本地白名单和服务端范围交集测试。
- `RagSearch`、`RagListKnowledgeBases` 工具 schema、注册、执行和结果格式测试。
- RAG 工具列表不存在写工具测试。
- RAG Hub 页面及现有 Chat、Skills、MCP、定时任务回归。
- TypeScript 构建、Biome、Rust 测试和现有前后端测试集。

### 16.3 端到端场景

1. 配置管理 Key 与 Agent Key。
2. 创建知识库并加入 Agent 白名单。
3. 上传一份包含明确答案的制度文档。
4. 等待入库任务进入 `SUCCEEDED`，确认文档进入 `READY`。
5. 在检索实验室验证原始召回和重排结果。
6. 在聊天中提出制度问题。
7. 确认 Agent 调用 `RagSearch` 并返回正确来源。
8. 请求未授权知识库并确认 fail-closed。
9. 禁用服务并确认内置 RAG 工具不再调用该服务。

## 17. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 现有业务服务依赖 Web DTO | 外部门面继续耦合 Controller | 定向引入 Command、Query、DTO、Assembler 和 Convert |
| 检索结果缺少来源字段 | 无法展示文档和引用 | 贯穿 `RetrievalHitDTO`，禁止丢弃向量 metadata |
| API Key 泄露 | 知识库被未授权访问 | 系统凭证库、双凭证、前端脱敏、服务端哈希、日志过滤 |
| URL 入库产生 SSRF | RAG 服务内网被探测 | 协议、DNS、IP、重定向、端口、大小和白名单校验 |
| 文档入库耗时较长 | 用户误认为失败 | `202 + jobId`、任务阶段、退避轮询和失败重试 |
| 清理失败留下孤儿向量 | 已删除文档仍可被召回 | 补偿任务、删除回归和孤儿数据巡检 |
| 多服务路由错误 | Agent 调错知识库 | 固定单服务调用、默认服务规则、显式 service_id 和清晰错误 |
| 重排服务不稳定 | 检索质量波动 | 显式降级告警并保留原始召回 |
| 首版范围过大 | 交付失控 | 固定 REST 契约、两个 Agent 工具、轮询任务、不实现 MCP 和跨服务融合 |

## 18. 验收标准

1. 左侧 RAG 入口可用且不破坏现有导航和聊天状态。
2. 可以配置至少两个 RAG 服务并设置默认服务。
3. 管理 Key 和 Agent Key 分离，均不出现在 React、同步数据、日志或错误信息中。
4. 可以创建知识库、上传文件、提交 URL、查看任务阶段并重试失败任务。
5. 可以查看文档 Chunk 并安全删除无活动任务的文档。
6. 可以在检索实验室对比召回与重排结果并查看来源和耗时。
7. Agent 工具列表只新增 `RagListKnowledgeBases` 和 `RagSearch`。
8. Agent 能检索授权知识库并根据返回 Chunk 引用来源。
9. Agent 无法发现或调用知识库写入、文档上传、重试或删除能力。
10. 默认服务、多服务选择和知识库白名单生效。
11. 服务离线、认证失败、知识库越权、重排失败和协议不兼容均有明确错误。
12. `E:\Code\RAG` 的改动全部位于从 `release/1.0` 创建的 `codex/rag-external-api` 分支。
13. 两个仓库相关自动化测试、构建和关键手工回归均通过。

## 19. 交付物

- Agent RAG Hub 和左侧导航入口。
- Agent RAG 服务配置、系统凭证存储、Rust 网关和 `ragent` 适配器。
- `RagListKnowledgeBases` 与 `RagSearch` 内置工具。
- RAG 项目版本化外部 REST API。
- 管理 Key 与 Agent Key 的认证、权限和知识库范围控制。
- 文件上传、URL 入库、任务状态、失败重试、删除和 Chunk 查询能力。
- 检索来源模型、重排降级和结构化结果。
- 双仓库测试代码、部署配置、密钥轮换说明和端到端验收记录。
