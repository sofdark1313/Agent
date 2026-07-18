# Agent 外置 RAG 服务集成项目计划书

日期：2026-07-18

## 1. 项目背景

Agent 当前已经提供 Skills、MCP、定时任务和工作区管理能力，但缺少面向知识库的专用管理入口。用户需要在左侧全局导航新增“RAG”，通过配置外置 RAG 服务完成知识库管理、文档入库、检索、重排，并让聊天 Agent 能按问题自动调用这些能力。

首个适配目标是上级目录的 `E:\Code\RAG` 项目。该项目已经具备知识库、文档入库、检索管道、重排服务和一个独立的 MCP 示例模块，但当前没有为 Agent 提供统一、稳定、带服务认证的外部接口。

## 2. 项目目标

本项目完成后应具备以下能力：

1. Agent 左侧导航新增与 Skills、MCP、定时任务同级的 RAG 入口。
2. 支持配置多个外置 RAG 服务，并设置默认服务、启用状态和 Agent 可访问范围。
3. 在 RAG Hub 中管理知识库、文档和入库任务。
4. 在 RAG Hub 中执行检索与重排测试，并查看召回结果、重排结果、来源和耗时。
5. 将启用的 RAG 服务自动投影成受 RAG Hub 管理的 MCP Server，使聊天 Agent 能按需调用只读 RAG 工具。
6. 为 `E:\Code\RAG` 增加版本化 REST API、RAG MCP 端点和独立 API Key 认证。
7. 保证 REST 与 MCP 共用同一套 RAG 业务实现，不复制检索、重排或知识库逻辑。

## 3. 已确认的产品决策

- 第一版同时提供完整 RAG 管理页和聊天 Agent 调用能力。
- 内置上级 RAG 项目适配器，同时保留服务地址和接口路径覆盖能力。
- 支持知识库的新建、编辑、删除，以及文档上传、状态查看和删除。
- 允许修改 `E:\Code\RAG`，但所有改动必须位于独立分支 `codex/rag-external-api`。
- Agent 根据问题自动判断是否调用 RAG，不对每条消息强制注入检索结果。
- 使用独立 API Key，不复用 RAG 管理员用户名和密码。
- 支持配置多个 RAG 服务，可指定一个默认服务。
- Agent 默认只获得知识库查询、检索、重排和状态查询等只读工具。
- 文档上传、知识库增删等写操作只允许用户在 RAG Hub 中执行。
- Agent 调用面复用 MCP，不新增一套私有工具协议。
- RAG Hub 管理面使用 REST API，文件上传、分页、任务进度和管理操作不通过 MCP 承载。

## 4. 非目标

第一版不包含以下内容：

- Agent 自动创建或删除知识库。
- Agent 自动上传、替换或删除文档。
- Agent 每轮对话无条件执行 RAG 检索。
- 在 Agent 内启动、停止或部署外置 RAG 服务。
- 将上级 RAG 项目的数据库、向量库或 Java 类直接嵌入 Agent。
- 第一版完整适配任意厂商的 RAG 协议。
- 对上级 RAG 项目进行与外部接入无关的大规模模块重构。

## 5. 总体架构

系统分为管理面和 Agent 调用面。

```text
┌──────────────────────── Agent ────────────────────────┐
│                                                       │
│  RAG Hub                                              │
│    └── Tauri RAG Client ── REST ───────────────┐      │
│                                                │      │
│  Chat Agent                                    │      │
│    └── Existing MCP Runtime ── MCP tools/call ─┼──┐   │
│                                                │  │   │
└────────────────────────────────────────────────┼──┼───┘
                                                 │  │
┌──────────────────── External RAG Service ──────┼──┼───┐
│                                                ▼  ▼   │
│  REST Controllers       RAG MCP Tool Handlers         │
│            └──────────────┬───────────────────┘       │
│                           ▼                           │
│            ExternalRagApplicationService             │
│              ├── KnowledgeBaseService                │
│              ├── KnowledgeDocumentService            │
│              ├── Ingestion Service                   │
│              ├── RetrievalEngine                     │
│              └── RerankService                       │
└───────────────────────────────────────────────────────┘
```

### 5.1 管理面

RAG Hub 通过 Tauri 后端访问 REST API，负责服务配置、连接测试、知识库管理、文件上传、入库状态和检索实验。API Key 不由 React 页面直接拼接到浏览器请求中。

### 5.2 Agent 调用面

启用 Agent 能力的 RAG 服务会被投影成一份运行时派生 MCP 配置。该配置复用现有 MCP 客户端、工具发现、调用并发、超时、审批元数据和工具结果展示能力，不要求用户在 MCP Hub 中重复配置。

### 5.3 RAG 业务复用

REST Controller 和 MCP Tool Handler 只负责协议适配、认证、参数校验和响应包装。两者统一调用 `ExternalRagApplicationService`，由该门面复用现有知识库、入库、检索和重排服务。

## 6. 上级 RAG 项目的实施边界

### 6.1 分支约束

在 `E:\Code\RAG` 创建并使用：

```text
codex/rag-external-api
```

RAG 项目的实现、测试和提交全部留在该分支，不直接改写其主分支历史。

### 6.2 MCP 现状与处理方式

现有 `mcp-server` 模块已经使用 Model Context Protocol SDK 和 Streamable HTTP，但当前只包含天气、工单和销售等示例工具，也没有访问 `bootstrap` 中 RAG 核心业务的依赖关系。

第一版 RAG MCP 端点应运行在实际 RAG 主服务中，直接调用 RAG 业务门面。现有示例模块可保留，其传输和工具 Schema 实现可作为参考，但不能作为 RAG 检索运行时直接复用。后续如需独立部署 MCP Server，再单独规划公共应用模块抽取。

### 6.3 外部接口前缀

REST API 使用版本化前缀：

```text
/api/external/v1
```

MCP Streamable HTTP 端点使用：

```text
/mcp/rag
```

### 6.4 REST API 范围

第一版至少提供：

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
GET    /api/external/v1/documents/{id}
DELETE /api/external/v1/documents/{id}
GET    /api/external/v1/documents/{id}/status

POST   /api/external/v1/retrieval
POST   /api/external/v1/rerank
```

接口应复用现有业务服务，不允许通过新的 Controller 复制已有入库或检索逻辑。

### 6.5 MCP 工具范围

第一版只暴露只读工具：

```text
rag_list_knowledge_bases
rag_search
rag_rerank
rag_get_document_status
```

不暴露知识库增删、文档上传或删除工具。

`rag_search` 完成一次完整的召回、去重和可选重排，避免 Agent 为正常检索进行两次网络调用。`rag_rerank` 用于对调用方已有候选内容进行独立重排。

## 7. 核心数据契约

### 7.1 服务能力

`GET /capabilities` 返回：

- 协议版本和服务版本；
- 支持的知识库管理能力；
- 支持的文档来源与文件类型；
- 支持的切片策略；
- 是否支持独立检索、重排和 MCP；
- 允许的 `topK`、`topN`、候选数量和请求体限制。

Agent 连接时必须校验协议主版本。主版本不兼容时禁止启用，不以猜测方式继续调用。

### 7.2 检索请求

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

### 7.3 检索响应

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

REST 与 MCP 返回的业务字段保持一致。MCP 层仅将结构化结果包装为协议允许的内容，不改变字段语义。

## 8. API Key 与权限设计

RAG 项目新增独立的服务 API Key 机制：

- 服务端只保存 Key 哈希，不保存明文；
- 支持名称、启用状态、过期时间和最后使用时间；
- 日志中不得输出 Key、Authorization Header 或完整敏感配置；
- 认证失败统一返回稳定错误码；
- 支持按权限范围限制接口。

建议权限范围：

```text
knowledge:read
knowledge:write
ingestion:write
retrieval:execute
rerank:execute
mcp:connect
```

第一版一个 RAG 服务配置使用一个 API Key。Agent 的写权限通过 MCP 工具白名单进一步收紧，模型无法发现或调用管理写操作。

## 9. Agent 中的 RAG 服务模型

每个服务包含：

- 服务 ID、名称和适配器类型；
- 启用状态与默认服务标记；
- 管理 API 地址；
- MCP 地址；
- API Key；
- 请求超时；
- 可选接口路径覆盖；
- Agent 是否启用；
- Agent 可访问的知识库白名单；
- 最近一次健康检查结果和能力快照。

首个适配器类型为 `ragent`。用户填写主地址后，系统默认推导管理 API 和 MCP 地址；高级配置允许覆盖。

API Key 必须由 Tauri 后端持久化和读取。前端获取配置时只得到“是否已配置密钥”等脱敏信息。

## 10. 派生 MCP 配置

启用的 RAG 服务在运行时生成派生 MCP Server：

```json
{
  "name": "rag_company_rag",
  "transport": "http",
  "url": "http://127.0.0.1:8080/mcp/rag",
  "headers": {
    "Authorization": "Bearer <API_KEY>"
  },
  "origin": "rag",
  "managedBy": "company-rag"
}
```

约束如下：

- 派生配置不在 MCP Hub 中重复展示为普通配置；
- RAG Hub 是其唯一配置所有者；
- 禁用或删除 RAG 服务后，派生 MCP Server 立即失效；
- 多服务通过 MCP Server 命名空间避免工具重名；
- 连接失败只影响对应 RAG 服务，不影响普通 MCP Server。

## 11. RAG Hub 页面计划

### 11.1 服务页

- 查看多个 RAG 服务及在线状态；
- 新增、编辑、删除和启停服务；
- 设置默认服务；
- 配置地址、API Key 和超时；
- 分别测试 REST 和 MCP；
- 查看协议版本、服务版本和能力；
- 配置 Agent 可访问的知识库。

连接测试依次验证健康接口、认证、协议版本、MCP 初始化和必需工具发现。

### 11.2 知识库页

- 查看、搜索、新建、编辑和删除知识库；
- 查看文档数量、更新时间和索引状态；
- 控制知识库是否允许 Agent 访问；
- 进入知识库文档管理。

### 11.3 文档页

- 上传本地文件或提交 URL；
- 选择切片策略或入库 Pipeline；
- 查看解析、切片、向量化和持久化状态；
- 展示失败节点与错误原因；
- 查看 Chunk；
- 重新触发允许重试的任务；
- 删除文档。

### 11.4 检索实验室

- 输入查询；
- 选择服务和一个或多个知识库；
- 设置召回数量和重排数量；
- 开关重排；
- 对比原始召回和重排结果；
- 查看分数、来源、文档、Chunk、耗时和告警；
- 支持单独提交候选内容测试重排。

## 12. Agent 检索流程

一次典型检索流程为：

```text
用户提问
→ Agent 判断需要内部知识
→ 调用对应 RAG MCP Server 的 rag_search
→ Agent 现有 MCP Runtime 发出 tools/call
→ RAG API Key 认证与知识库访问校验
→ RetrievalEngine 多通道召回
→ 合并、去重和可选 Rerank
→ MCP 返回标准化 Chunk、来源、分数和耗时
→ Agent 基于结果回答并引用来源
```

模型不可访问 API Key，也不能通过 MCP 上传或删除文档。

## 13. 错误处理与降级

### 13.1 服务离线

RAG Hub 显示离线状态。Agent 调用返回明确的 MCP 工具错误，不自动切换到未授权服务。

### 13.2 REST 可用但 MCP 不可用

管理功能继续可用，但该服务不向 Agent 注册工具，并显示“管理可用，Agent 接入异常”。

### 13.3 重排失败

允许按服务策略降级为原始召回结果，但响应必须包含 `RERANK_UNAVAILABLE` 告警，不能静默声称已经重排。

### 13.4 入库失败

保留任务阶段、失败节点、错误码和可重试信息。单文档失败不影响同知识库中的其他文档。

### 13.5 协议不兼容

协议主版本不兼容时禁止启用；次版本差异通过 capabilities 判断可选能力。

## 14. 实施阶段与里程碑

### 阶段一：契约和安全基线

- 创建 RAG 独立分支；
- 定义 REST、MCP、错误码和 capabilities 契约；
- 实现 API Key 模型、认证过滤器和日志脱敏；
- 建立契约测试。

完成标志：认证、健康检查和能力发现可独立通过测试。

### 阶段二：RAG 外部业务接口

- 建立统一应用服务门面；
- 接入知识库和文档管理；
- 接入文档上传和状态查询；
- 接入检索和重排；
- 为每组接口完成全量 API 回归。

完成标志：第三方客户端可以只通过 REST 完成知识库管理、文档入库和检索实验。

### 阶段三：RAG MCP 服务

- 在实际 RAG 主服务中增加 `/mcp/rag`；
- 实现四个只读工具；
- 复用应用服务门面；
- 验证工具发现、调用、认证、边界参数和错误结果。

完成标志：通用 MCP 客户端可以发现并调用 RAG 工具。

### 阶段四：Agent 配置与 Tauri 客户端

- 增加 RAG 设置模型和数据库迁移；
- 实现密钥后端持久化与脱敏读取；
- 实现 REST 客户端、上传、超时和错误映射；
- 实现服务连接测试和能力缓存。

完成标志：Agent 可以安全保存多个 RAG 服务并完成连接测试。

### 阶段五：RAG Hub

- 增加左侧 RAG 导航和页面路由状态；
- 完成服务、知识库、文档和检索实验室页面；
- 完成空状态、加载、失败、确认和进度交互；
- 完成浅色、深色和窄窗口验证。

完成标志：用户无需访问 RAG 原管理前端即可完成第一版范围内的管理操作。

### 阶段六：Agent MCP 集成

- 将 RAG 服务投影为派生 MCP Server；
- 接入知识库白名单；
- 处理多服务工具命名空间；
- 确认写工具不会进入 Agent 工具列表；
- 验证完整问答链路和工具结果展示。

完成标志：Agent 能按问题自动调用已启用的 RAG 服务并引用结果。

### 阶段七：联合验收

- 执行两个仓库的全部相关测试；
- 完成真实文档上传和入库；
- 完成向量召回、重排和降级场景；
- 完成多服务、离线、错误密钥和版本不兼容场景；
- 整理部署配置和使用说明。

## 15. 测试计划

### 15.1 RAG 项目

- API Key 创建、校验、禁用、过期和权限测试；
- REST Controller 参数与错误码测试；
- 应用服务门面单元测试；
- 知识库和文档 API 回归；
- 上传、入库状态和失败恢复测试；
- 检索、去重、重排与重排降级测试；
- MCP 初始化、工具发现和 tools/call 测试；
- REST 与 MCP 结果字段一致性测试；
- 日志敏感信息扫描。

### 15.2 Agent 项目

- RAG 设置默认值和数据库迁移测试；
- API Key 不回传前端测试；
- 服务地址和能力响应解析测试；
- 上传、超时和错误映射测试；
- 派生 MCP 配置生成与删除测试；
- 多 RAG 服务工具命名空间测试；
- Agent 知识库白名单测试；
- RAG Hub 服务、知识库、文档和检索交互测试；
- 左侧导航与现有 Chat、Skills、MCP、定时任务回归；
- TypeScript 构建、Biome 和现有前后端测试集。

### 15.3 端到端场景

使用一份包含明确答案的制度文档执行：

1. 创建知识库；
2. 上传文档；
3. 等待入库成功；
4. 在检索实验室验证召回和重排；
5. 在聊天中提出制度问题；
6. 确认 Agent 调用正确的 RAG MCP 工具；
7. 确认回答包含正确答案和文档来源；
8. 关闭 RAG 服务并确认工具不再可用。

## 16. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 现有 `mcp-server` 与 RAG 核心隔离 | 无法直接复用业务服务 | 第一版在实际 RAG 主服务中托管 RAG MCP 端点 |
| REST 与 MCP 语义漂移 | 同一查询产生不同格式 | 共用应用服务门面和响应 DTO，并增加一致性测试 |
| API Key 泄露 | 外部知识库被未授权访问 | 后端持久化、前端脱敏、日志过滤、服务端哈希 |
| 文档上传耗时较长 | 用户误认为操作失败 | 上传与入库状态分离，展示阶段和轮询进度 |
| 多服务工具重名 | Agent 调错服务 | 使用派生 MCP Server 命名空间并提供清晰描述 |
| 重排服务不稳定 | 检索质量波动 | 显式降级告警，保留原始召回结果 |
| 上游接口演进 | Agent 接入失效 | 版本化 API 和 capabilities 协商 |
| 功能范围过大 | 首版交付失控 | 严格限制 MCP 为只读工具，不在首版做自动部署与通用协议编辑器 |

## 17. 验收标准

项目只有同时满足以下条件才视为完成：

1. 左侧 RAG 入口可用，且不破坏现有导航和聊天状态。
2. 可以配置至少两个 RAG 服务并设置默认服务。
3. API Key 不出现在 React 可读取的完整设置、日志或错误信息中。
4. 可以创建知识库、上传文档并查看入库最终状态。
5. 可以在检索实验室查看召回和重排后的结果及耗时。
6. 启用的 RAG 服务能自动注册为派生 MCP Server。
7. Agent 能调用 `rag_search` 并基于返回 Chunk 回答。
8. Agent 工具列表中不存在知识库删除、文档上传等写工具。
9. 多服务工具不存在名称冲突，知识库白名单生效。
10. RAG 服务离线、认证失败、重排失败和版本不兼容均有明确可操作错误。
11. `E:\Code\RAG` 的改动全部位于 `codex/rag-external-api` 分支。
12. 两个仓库相关自动化测试、构建和关键手工回归均通过。

## 18. 交付物

- Agent RAG Hub 和左侧导航入口；
- Agent RAG 配置、Tauri 客户端和派生 MCP 集成；
- RAG 项目版本化外部 REST API；
- RAG MCP Streamable HTTP 端点和只读工具；
- API Key 认证与权限控制；
- 双仓库测试代码；
- 服务配置、部署和使用说明；
- 端到端验收记录。
