# Agent Built-in RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Agent 桌面端新增多服务 RAG Hub、系统凭证存储、Rust RAG 网关，以及 `RagListKnowledgeBases`、`RagSearch` 两个内置只读工具，全程不派生 MCP。

**Architecture:** React 只调用 Tauri commands，不直接访问外部 RAG 服务；非敏感服务配置存 SQLite，管理 Key 与 Agent Key 存系统凭证库。RAG Hub 管理操作与 Agent 只读工具共用 Rust `RagGatewayService`、访问策略和 `RagentAdapter`，只有满足启用、Agent 凭证和协议兼容条件的服务才触发工具注册。

**Tech Stack:** React 19、TypeScript 7、Tauri 2、Rust 2021、reqwest 0.13、rusqlite、keyring、Node test runner、Cargo test。

---

## File structure

- `src-tauri/src/services/rag`：配置仓储、凭证仓储、访问策略、适配器、响应标准化和网关。
- `src-tauri/src/commands/integration/rag.rs`：全部 RAG Tauri commands，区分 Hub 与 Agent 入口。
- `src/lib/rag`：React/Tauri 类型和调用封装，不保存密钥。
- `src/lib/tools/ragTools.ts`：两个 Agent 内置只读工具。
- `src/pages/rag-hub`：服务、知识库、文档和检索实验室界面。
- `src/pages/ChatPage.tsx` 与 `ChatHistorySidebar.tsx`：增加 RAG Hub 视图和入口。

### Task 1: 建立 Rust RAG 配置模型、SQLite 表和默认服务规则

**Files:**
- Create: `agent-gui/src-tauri/src/services/rag/mod.rs`
- Create: `agent-gui/src-tauri/src/services/rag/model.rs`
- Create: `agent-gui/src-tauri/src/services/rag/error.rs`
- Create: `agent-gui/src-tauri/src/services/rag/service_store.rs`
- Modify: `agent-gui/src-tauri/src/services/mod.rs`
- Modify: `agent-gui/src-tauri/src/commands/config/settings/db.rs`
- Test: `agent-gui/src-tauri/src/services/rag/tests.rs`

- [ ] **Step 1: 写多服务和默认服务失败测试**

```rust
#[test]
fn saving_a_new_default_clears_the_previous_default() {
    let store = test_store();
    store.save(service("a", true)).unwrap();
    store.save(service("b", true)).unwrap();

    let services = store.list().unwrap();
    assert_eq!(services.iter().filter(|item| item.is_default).count(), 1);
    assert!(services.iter().find(|item| item.id == "b").unwrap().is_default);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test services::rag --manifest-path agent-gui/src-tauri/Cargo.toml`

Expected: FAIL，提示 `services::rag` 不存在。

- [ ] **Step 3: 实现模型和表结构**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RagServiceConfig {
    pub id: String,
    pub name: String,
    pub adapter_type: String,
    pub base_url: String,
    pub enabled: bool,
    pub is_default: bool,
    pub agent_enabled: bool,
    pub agent_knowledge_base_ids: Vec<String>,
    pub timeout_ms: u64,
    pub management_credential_configured: bool,
    pub agent_credential_configured: bool,
    pub capabilities_snapshot: Option<RagCapabilities>,
}
```

`rag_services` 表只保存上述非敏感字段；`save()` 在事务内保证最多一个默认服务。删除默认服务后不自动猜选其他服务。

- [ ] **Step 4: 运行 Rust 测试**

Run: `cargo test services::rag --manifest-path agent-gui/src-tauri/Cargo.toml`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add agent-gui/src-tauri/src/services agent-gui/src-tauri/src/commands/config/settings/db.rs
git commit -m "feat: add RAG service configuration store"
```

### Task 2: 使用系统凭证库保存管理 Key 和 Agent Key

**Files:**
- Modify: `agent-gui/src-tauri/Cargo.toml`
- Modify: `agent-gui/src-tauri/Cargo.lock`
- Create: `agent-gui/src-tauri/src/services/rag/credential_store.rs`
- Modify: `agent-gui/src-tauri/src/services/rag/mod.rs`
- Test: `agent-gui/src-tauri/src/services/rag/tests.rs`

- [ ] **Step 1: 写凭证不落库和失败不降级测试**

```rust
#[test]
fn credential_store_never_falls_back_to_sqlite() {
    let backend = FailingCredentialBackend::new("vault unavailable");
    let store = RagCredentialStore::new(backend);
    let error = store.set("svc", RagCredentialKind::Agent, "secret").unwrap_err();
    assert_eq!(error.code(), "RAG_CREDENTIAL_STORE_UNAVAILABLE");
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test credential_store --manifest-path agent-gui/src-tauri/Cargo.toml`

Expected: FAIL。

- [ ] **Step 3: 添加 keyring 3 和可测试后端接口**

```rust
pub trait CredentialBackend: Send + Sync {
    fn set(&self, account: &str, secret: &str) -> Result<(), RagError>;
    fn get(&self, account: &str) -> Result<Option<String>, RagError>;
    fn delete(&self, account: &str) -> Result<(), RagError>;
}

pub enum RagCredentialKind { Management, Agent }
```

生产实现使用服务名 `ai.agent.rag`，账户名为 `<service_id>:management` 或 `<service_id>:agent`。读取配置只返回 `configured` 标志；删除服务同步删除两类凭证。凭证库异常直接失败，不把明文写入 SQLite、日志或错误文本。

- [ ] **Step 4: 运行凭证测试**

Run: `cargo test credential_store --manifest-path agent-gui/src-tauri/Cargo.toml`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add agent-gui/src-tauri/Cargo.toml agent-gui/src-tauri/Cargo.lock agent-gui/src-tauri/src/services/rag
git commit -m "feat: secure RAG credentials in system vault"
```

### Task 3: 实现访问策略、ragent REST 适配器和响应标准化

**Files:**
- Create: `agent-gui/src-tauri/src/services/rag/access_policy.rs`
- Create: `agent-gui/src-tauri/src/services/rag/adapter.rs`
- Create: `agent-gui/src-tauri/src/services/rag/ragent_adapter.rs`
- Create: `agent-gui/src-tauri/src/services/rag/normalizer.rs`
- Create: `agent-gui/src-tauri/src/services/rag/gateway.rs`
- Modify: `agent-gui/src-tauri/src/services/rag/mod.rs`
- Test: `agent-gui/src-tauri/src/services/rag/tests.rs`

- [ ] **Step 1: 写默认选择、白名单和协议错误测试**

```rust
#[test]
fn agent_search_rejects_any_forbidden_knowledge_base() {
    let policy = RagAccessPolicy::default();
    let service = service_with_agent_kbs(&["hr"]);
    let error = policy.authorize_agent_search(&service, &["hr".into(), "finance".into()])
        .unwrap_err();
    assert_eq!(error.code(), "RAG_KB_FORBIDDEN");
}

#[test]
fn multiple_enabled_services_without_default_is_an_error() {
    assert_eq!(resolve_service(None, &[service("a"), service("b")]).unwrap_err().code(),
               "RAG_SERVICE_NOT_FOUND");
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test services::rag --manifest-path agent-gui/src-tauri/Cargo.toml`

Expected: FAIL。

- [ ] **Step 3: 实现适配器接口和网关**

```rust
#[async_trait]
pub trait RagAdapter: Send + Sync {
    async fn health(&self, ctx: &RagRequestContext) -> Result<RagHealth, RagError>;
    async fn capabilities(&self, ctx: &RagRequestContext) -> Result<RagCapabilities, RagError>;
    async fn list_knowledge_bases(&self, ctx: &RagRequestContext) -> Result<Vec<RagKnowledgeBase>, RagError>;
    async fn search(&self, ctx: &RagRequestContext, request: RagSearchRequest) -> Result<RagSearchResponse, RagError>;
    async fn upload_document(&self, ctx: &RagRequestContext, request: RagUploadRequest) -> Result<RagAcceptedJob, RagError>;
}
```

完整 trait 还包含设计稿中的知识库 CRUD、文档查询、URL 入库、job 查询/重试、删除、Chunk 和 rerank。`RagentAdapter` 使用 `reqwest::Client`，限制超时与响应体，拒绝非 localhost 的 HTTP Base URL，不自动跨 Origin 携带 Authorization。capabilities 以服务 ID 缓存 5 分钟，保存配置、替换凭证和测试连接时立即失效。

- [ ] **Step 4: 运行网关测试**

Run: `cargo test services::rag --manifest-path agent-gui/src-tauri/Cargo.toml`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add agent-gui/src-tauri/src/services/rag
git commit -m "feat: add RAG gateway and ragent adapter"
```

### Task 4: 注册 Hub 与 Agent 分离的 Tauri commands

**Files:**
- Create: `agent-gui/src-tauri/src/commands/integration/rag.rs`
- Modify: `agent-gui/src-tauri/src/commands/integration/mod.rs`
- Modify: `agent-gui/src-tauri/src/commands/mod.rs`
- Modify: `agent-gui/src-tauri/src/lib.rs`
- Test: `agent-gui/src-tauri/src/services/rag/tests.rs`

- [ ] **Step 1: 写 Agent command 无写分支测试**

```rust
#[test]
fn agent_command_surface_contains_only_list_and_search() {
    let source = include_str!("../../commands/integration/rag.rs");
    assert!(source.contains("rag_agent_list_knowledge_bases"));
    assert!(source.contains("rag_agent_search"));
    assert!(!source.contains("rag_agent_upload"));
    assert!(!source.contains("rag_agent_delete"));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test agent_command_surface --manifest-path agent-gui/src-tauri/Cargo.toml`

Expected: FAIL。

- [ ] **Step 3: 实现并注册 commands**

服务 commands：`rag_list_services`、`rag_save_service`、`rag_delete_service`、`rag_set_default_service`、`rag_test_service`。

Hub commands：知识库 CRUD、文档列表/上传/URL 导入/job 查询/重试/删除/Chunk、search、rerank。

Agent commands 只注册：

```rust
#[tauri::command]
pub async fn rag_agent_list_knowledge_bases(...) -> Result<Vec<RagKnowledgeBase>, RagCommandError>;

#[tauri::command]
pub async fn rag_agent_search(...) -> Result<RagSearchResponse, RagCommandError>;
```

- [ ] **Step 4: 运行 command 测试和 Cargo 检查**

Run: `cargo test services::rag --manifest-path agent-gui/src-tauri/Cargo.toml`

Expected: PASS。

Run: `cargo check --manifest-path agent-gui/src-tauri/Cargo.toml`

Expected: Finished。

- [ ] **Step 5: 提交**

```bash
git add agent-gui/src-tauri/src/commands agent-gui/src-tauri/src/lib.rs agent-gui/src-tauri/src/services/rag
git commit -m "feat: expose RAG Tauri commands"
```

### Task 5: 增加 TypeScript RAG IPC 客户端和契约类型

**Files:**
- Create: `agent-gui/src/lib/rag/types.ts`
- Create: `agent-gui/src/lib/rag/client.ts`
- Create: `agent-gui/src/lib/rag/index.ts`
- Test: `agent-gui/test/rag/client.test.mjs`

- [ ] **Step 1: 写密钥不回传和 command 映射测试**

```js
test("service responses expose configured flags but never credential fields", async () => {
  const services = await client.listServices();
  assert.equal(services[0].managementCredentialConfigured, true);
  assert.equal("managementApiKey" in services[0], false);
  assert.equal("agentApiKey" in services[0], false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test agent-gui/test/rag/client.test.mjs`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 typed invoke 封装**

```ts
export type RagServiceConfig = {
  id: string;
  name: string;
  adapterType: "ragent";
  baseUrl: string;
  enabled: boolean;
  default: boolean;
  agentEnabled: boolean;
  agentKnowledgeBaseIds: string[];
  timeoutMs: number;
  managementCredentialConfigured: boolean;
  agentCredentialConfigured: boolean;
};

export const ragClient = {
  listServices: () => invoke<RagServiceConfig[]>("rag_list_services"),
  agentSearch: (request: RagAgentSearchRequest) =>
    invoke<RagSearchResponse>("rag_agent_search", { request }),
};
```

保存服务时允许提交可选 `managementApiKeyUpdate` 和 `agentApiKeyUpdate`，客户端不得持久化它们，也不得把服务响应扩展为可读取的密钥字段。

- [ ] **Step 4: 运行 IPC 客户端测试**

Run: `node --test agent-gui/test/rag/client.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add agent-gui/src/lib/rag agent-gui/test/rag
git commit -m "feat: add typed RAG IPC client"
```

### Task 6: 实现 RagListKnowledgeBases 和 RagSearch 内置工具

**Files:**
- Create: `agent-gui/src/lib/tools/ragTools.ts`
- Modify: `agent-gui/src/lib/tools/builtinRegistry.ts`
- Test: `agent-gui/test/tools/rag-tools.test.mjs`
- Test: `agent-gui/test/tools/builtin-registry-rag.test.mjs`

- [ ] **Step 1: 写工具 schema、条件注册和白名单测试**

```js
test("RAG tools register only when an eligible service exists", async () => {
  const registry = await buildRegistry({ ragStatus: { available: true } });
  assert.equal(registry.hasTool("RagListKnowledgeBases"), true);
  assert.equal(registry.hasTool("RagSearch"), true);
});

test("RagSearch returns a stable citation text and structured details", async () => {
  const result = await executeSearch({ query: "年假", knowledge_base_ids: ["hr"] });
  assert.match(result.content[0].text, /\[1\].*员工休假管理制度/);
  assert.equal(result.details.results[0].documentId, "doc-1");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test agent-gui/test/tools/rag-tools.test.mjs agent-gui/test/tools/builtin-registry-rag.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 实现只读工具 bundle**

```ts
export function createRagTools(options: RagToolOptions): BuiltinToolBundle {
  return {
    tools: [ragListKnowledgeBasesTool, ragSearchTool],
    metadataByName: new Map([
      ["RagListKnowledgeBases", { readOnly: true }],
      ["RagSearch", { readOnly: true }],
    ]),
    executeToolCall: async (call, signal) => executeRagTool(call, signal, options),
  };
}
```

工具描述为固定受控文本。`RagSearch` 参数限制 query 4000 字符、top_k 1..50、top_n 1..20；服务端和 Rust 网关负责最终上限及白名单校验。错误结果保留稳定 code，不自动切换服务。

- [ ] **Step 4: 运行工具测试**

Run: `node --test agent-gui/test/tools/rag-tools.test.mjs agent-gui/test/tools/builtin-registry-rag.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add agent-gui/src/lib/tools agent-gui/test/tools
git commit -m "feat: add built-in read-only RAG tools"
```

### Task 7: 构建 RAG Hub 服务管理页

**Files:**
- Create: `agent-gui/src/pages/rag-hub/RagHubPage.tsx`
- Create: `agent-gui/src/pages/rag-hub/RagServicePanel.tsx`
- Create: `agent-gui/src/pages/rag-hub/RagServiceModal.tsx`
- Create: `agent-gui/src/pages/rag-hub/useRagHubState.ts`
- Modify: `agent-gui/src/components/icons.tsx`
- Test: `agent-gui/test/rag/service-model.test.mjs`

- [ ] **Step 1: 写表单归一化和密钥更新语义测试**

```js
test("editing without a new key preserves configured credentials", () => {
  const payload = buildSavePayload(existingService, formWithoutNewKeys);
  assert.equal(payload.managementApiKeyUpdate, undefined);
  assert.equal(payload.agentApiKeyUpdate, undefined);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test agent-gui/test/rag/service-model.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 实现服务卡片、编辑弹窗和连接测试**

页面延续现有 Hub 视觉语言，使用青绿色知识网络色调；服务卡显示启用、默认、Agent 开放、管理/Agent 凭证已配置、协议版本和健康状态。密钥输入为一次性更新字段，关闭弹窗即清空本地 state；测试连接分别验证管理和 Agent 凭证。

- [ ] **Step 4: 运行 UI 模型测试和构建**

Run: `node --test agent-gui/test/rag/service-model.test.mjs`

Expected: PASS。

Run: `npm run build --prefix agent-gui`

Expected: build succeeds。

- [ ] **Step 5: 提交**

```bash
git add agent-gui/src/pages/rag-hub agent-gui/src/components/icons.tsx agent-gui/test/rag
git commit -m "feat: add RAG service management UI"
```

### Task 8: 增加知识库与文档入库管理

**Files:**
- Create: `agent-gui/src/pages/rag-hub/RagKnowledgePanel.tsx`
- Create: `agent-gui/src/pages/rag-hub/RagDocumentPanel.tsx`
- Create: `agent-gui/src/pages/rag-hub/RagUploadModal.tsx`
- Create: `agent-gui/src/pages/rag-hub/RagUrlImportModal.tsx`
- Create: `agent-gui/src/pages/rag-hub/ingestionPolling.ts`
- Modify: `agent-gui/src/pages/rag-hub/RagHubPage.tsx`
- Test: `agent-gui/test/rag/ingestion-polling.test.mjs`

- [ ] **Step 1: 写退避轮询和终态停止测试**

```js
test("polling backs off and stops at a terminal ingestion status", async () => {
  const delays = [];
  const result = await pollIngestionJob(fetchSequence("PENDING", "RUNNING", "SUCCEEDED"), {
    sleep: async (ms) => delays.push(ms),
  });
  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(delays, [1000, 2000]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test agent-gui/test/rag/ingestion-polling.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 实现知识库、上传、URL、状态、重试、Chunk 和删除 UI**

上传使用 Tauri 文件选择器返回路径，由 Rust 流式读取并上传；React 不读取文件二进制。任务轮询间隔为 1s、2s、4s、8s，之后固定 10s，进入 `SUCCEEDED/FAILED/CANCELLED` 即停止。失败卡显示阶段、稳定错误码、原因和 retryable；活动任务时隐藏删除操作并显示占用状态。

- [ ] **Step 4: 运行入库模型测试和构建**

Run: `node --test agent-gui/test/rag/ingestion-polling.test.mjs`

Expected: PASS。

Run: `npm run build --prefix agent-gui`

Expected: build succeeds。

- [ ] **Step 5: 提交**

```bash
git add agent-gui/src/pages/rag-hub agent-gui/test/rag
git commit -m "feat: add RAG document ingestion UI"
```

### Task 9: 增加检索与重排实验室

**Files:**
- Create: `agent-gui/src/pages/rag-hub/RagRetrievalLab.tsx`
- Create: `agent-gui/src/pages/rag-hub/retrievalModel.ts`
- Modify: `agent-gui/src/pages/rag-hub/RagHubPage.tsx`
- Test: `agent-gui/test/rag/retrieval-model.test.mjs`

- [ ] **Step 1: 写原始召回与重排结果映射测试**

```js
test("retrieval model keeps raw and reranked positions explicit", () => {
  const model = toRetrievalRows(responseWithRawAndFinalRanks);
  assert.equal(model.raw[0].rankBefore, 1);
  assert.equal(model.final[0].rankAfter, 1);
  assert.equal(model.final[0].documentName, "员工休假管理制度.md");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test agent-gui/test/rag/retrieval-model.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 实现检索表单和对比结果**

支持服务、多个知识库、query、topK、rerank 开关和 topN；结果分为“原始召回”和“最终结果”两栏，显示 score、source、文档、Chunk、metadata、retrieval/rerank/total 耗时和 warnings。独立 rerank 测试限制候选数量和单条文本长度。

- [ ] **Step 4: 运行检索模型测试和构建**

Run: `node --test agent-gui/test/rag/retrieval-model.test.mjs`

Expected: PASS。

Run: `npm run build --prefix agent-gui`

Expected: build succeeds。

- [ ] **Step 5: 提交**

```bash
git add agent-gui/src/pages/rag-hub agent-gui/test/rag
git commit -m "feat: add RAG retrieval lab"
```

### Task 10: 接入左侧导航、ChatPage 视图和中英文文案

**Files:**
- Modify: `agent-gui/src/pages/ChatPage.tsx`
- Modify: `agent-gui/src/components/chat/ChatHistorySidebar.tsx`
- Modify: `agent-gui/src/i18n/config.ts`
- Test: `agent-gui/test/ui/rag-hub-navigation.test.mjs`
- Test: `agent-gui/test/i18n/translations.test.mjs`

- [ ] **Step 1: 写导航和视图联合类型测试**

```js
test("sidebar and ChatPage expose the RAG Hub view", () => {
  assert.match(sidebarSource, /"rag-hub"/);
  assert.match(chatPageSource, /<RagHubPage/);
  assert.match(chatPageSource, /setActiveView\("rag-hub"\)/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test agent-gui/test/ui/rag-hub-navigation.test.mjs agent-gui/test/i18n/translations.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 接入 RAG Hub**

`activeView` 扩展为 `"chat" | "skills-hub" | "mcp-hub" | "cron-hub" | "rag-hub"`。左侧 RAG 与 Skills、MCP、定时任务同级；打开 Hub 时沿用当前侧栏开关，不影响草稿会话和 Chat 状态。补齐 `zh-CN`、`en-US` 的服务、知识库、文档、检索、凭证、状态和错误文案。

- [ ] **Step 4: 运行导航、i18n 和前端全量测试**

Run: `node --test agent-gui/test/ui/rag-hub-navigation.test.mjs agent-gui/test/i18n/translations.test.mjs`

Expected: PASS。

Run: `npm run test:frontend --prefix agent-gui`

Expected: all tests pass。

- [ ] **Step 5: 提交**

```bash
git add agent-gui/src/pages/ChatPage.tsx agent-gui/src/components/chat/ChatHistorySidebar.tsx agent-gui/src/i18n/config.ts agent-gui/test/ui agent-gui/test/i18n
git commit -m "feat: integrate RAG Hub navigation"
```

### Task 11: 双仓库联调与安全回归

**Files:**
- Create: `docs/rag-integration-runbook.md`
- Create: `agent-gui/test/rag/security-contract.test.mjs`
- Create: `agent-gui/test/rag/tool-contract.test.mjs`

- [ ] **Step 1: 写前端不出现密钥字段和无 MCP 路径测试**

```js
test("built-in RAG integration does not create an MCP server", () => {
  assert.doesNotMatch(allRagSources, /\/mcp\/rag|createMcp.*Rag|rag.*stdio/i);
});

test("credential fields never appear in persisted or returned service types", () => {
  assert.doesNotMatch(returnedServiceTypeSource, /managementApiKey:|agentApiKey:/);
});
```

- [ ] **Step 2: 运行安全契约测试确认失败点已全部覆盖**

Run: `node --test agent-gui/test/rag/security-contract.test.mjs agent-gui/test/rag/tool-contract.test.mjs`

Expected: PASS；若失败，修正实现后重复运行。

- [ ] **Step 3: 编写联调手册并执行真实服务冒烟**

手册包含：在 RAG 管理端创建管理/Agent Key、Agent 配置两个服务、设置默认服务、分别测试凭证、创建知识库、上传 Markdown、轮询至 READY、执行检索、验证引用、禁用默认服务、错误 Key、越权 KB、重排降级和协议版本不兼容。

- [ ] **Step 4: 执行完整验证**

Run: `npm test --prefix agent-gui`

Expected: all tests pass。

Run: `npm run build --prefix agent-gui`

Expected: build succeeds。

Run: `cargo test --manifest-path agent-gui/src-tauri/Cargo.toml`

Expected: all tests pass。

Run: `cargo check --manifest-path agent-gui/src-tauri/Cargo.toml`

Expected: Finished。

Run from `E:\Code\RAG`: `mvn -pl bootstrap -am test`

Expected: BUILD SUCCESS。

- [ ] **Step 5: 提交**

```bash
git add docs/rag-integration-runbook.md agent-gui/test/rag
git commit -m "test: verify built-in RAG integration"
```

## Final verification

- [ ] 可配置多个 RAG 服务，最多一个默认服务。
- [ ] React 响应、设置同步、导出和日志均不含 API Key。
- [ ] 系统凭证库不可用时保存失败，不回退明文 SQLite。
- [ ] RAG Hub 支持知识库、文件/URL 入库、状态、重试、删除、Chunk、检索和重排实验。
- [ ] Agent 只注册 `RagListKnowledgeBases` 与 `RagSearch`，没有任何 RAG 写工具。
- [ ] 请求包含任一越权知识库时 fail-closed。
- [ ] 第一版没有 `/mcp/rag`、RAG stdio server 或 MCP Runtime 路由。
- [ ] Agent 与 RAG 两仓库全量测试和构建通过。
