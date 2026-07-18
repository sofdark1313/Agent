# RAG External REST API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `E:\Code\RAG` 提供带双 API Key、知识库范围控制、异步文档入库、来源完整检索和重排能力的 `/api/external/v1/**` REST API。

**Architecture:** 在现有 `bootstrap` Maven 模块内新增 `external` 业务边界，内部按 `business / persistence / infrastructure / interfaces` 分层。外部 Controller 只做 HTTP 适配，业务服务复用现有知识库、文档、检索、重排和 RocketMQ 能力；API Key 只保存 SHA-256 摘要，并通过请求上下文执行 audience、scope 和知识库范围的 fail-closed 校验。

**Tech Stack:** Java 17、Spring Boot 3.5、MyBatis Plus、Sa-Token、RocketMQ、Milvus/PGVector、JUnit 5、Mockito、MockMvc、PostgreSQL。

---

## File structure

新增代码集中到 `bootstrap/src/main/java/com/nageoffer/ai/ragent/external`：

- `business/auth`：API Key 创建、轮换、禁用和鉴权用例。
- `business/knowledge`：知识库与文档管理门面，隔离 Controller Request/VO。
- `business/ingestion`：上传、URL 导入、任务状态、重试和删除编排。
- `business/retrieval`：按指定知识库检索、去重、可选重排与来源装配。
- `persistence`：外部 API Key、入库任务和幂等记录的数据访问。
- `infrastructure/security`：摘要校验、请求上下文、scope/audience/知识库策略。
- `infrastructure/client`：带 SSRF 防护的 URL 下载器。
- `interfaces/http`：版本化外部 REST、管理员 Key 管理入口、Request/Response/Assembler。

现有 `knowledge` 和 `rag` 模块只做定向扩展：增加传输无关 Command/DTO 入口、补齐检索来源字段，不复制业务逻辑。

### Task 1: 建立外部 API 契约、错误模型和能力端点

**Files:**
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/ExternalRagApiPaths.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/response/ExternalErrorResponse.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/business/ExternalRagErrorCodes.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/business/ExternalRagException.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/ExternalRagExceptionHandler.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/ExternalCapabilityController.java`
- Test: `bootstrap/src/test/java/com/nageoffer/ai/ragent/external/interfaces/http/ExternalCapabilityControllerTest.java`

- [ ] **Step 1: 写失败的能力和错误契约测试**

```java
@WebMvcTest(ExternalCapabilityController.class)
class ExternalCapabilityControllerTest {
    @Autowired private MockMvc mockMvc;

    @Test
    void health只返回最小存活信息() throws Exception {
        mockMvc.perform(get("/api/external/v1/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"))
                .andExpect(jsonPath("$.version").doesNotExist());
    }

    @Test
    void capabilities返回固定协议主版本和限制() throws Exception {
        mockMvc.perform(get("/api/external/v1/capabilities")
                        .requestAttr("externalApiPrincipal", ExternalApiPrincipal.managementForTest()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.protocolVersion").value("1.0"))
                .andExpect(jsonPath("$.limits.maxTopK").value(50))
                .andExpect(jsonPath("$.features.urlImport").value(true));
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `mvn -pl bootstrap -Dtest=ExternalCapabilityControllerTest test`

Expected: FAIL，提示 `ExternalCapabilityController` 或契约类型不存在。

- [ ] **Step 3: 实现稳定错误体和能力响应**

```java
public final class ExternalRagApiPaths {
    public static final String BASE = "/api/external/v1";
    public static final String HEALTH = BASE + "/health";
    public static final String CAPABILITIES = BASE + "/capabilities";
    private ExternalRagApiPaths() { }
}

@Getter
@Builder
public class ExternalErrorResponse {
    private final String code;
    private final String message;
    private final String requestId;
    private final boolean retryable;
}
```

`ExternalRagExceptionHandler` 将 `ExternalRagException` 映射为稳定 HTTP 状态和 `ExternalErrorResponse`，未知异常只返回 `RAG_RESPONSE_INVALID`，不得回传堆栈、SQL、密钥或请求体。

- [ ] **Step 4: 运行能力端点测试**

Run: `mvn -pl bootstrap -Dtest=ExternalCapabilityControllerTest test`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add bootstrap/src/main/java/com/nageoffer/ai/ragent/external bootstrap/src/test/java/com/nageoffer/ai/ragent/external
git commit -m "feat: add external RAG protocol contract"
```

### Task 2: 增加双 API Key 持久化、一次性明文返回和请求上下文

**Files:**
- Create: `sql/postgresql/migrations/v1.2-to-v1.3.sql`
- Modify: `sql/postgresql/schema.sql`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/persistence/auth/model/ExternalApiKeyDO.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/persistence/auth/mapper/ExternalApiKeyMapper.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/persistence/auth/repo/ExternalApiKeyRepo.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/persistence/auth/repo/impl/ExternalApiKeyRepoImpl.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/business/auth/command/CreateExternalApiKeyCommand.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/business/auth/dto/CreatedExternalApiKeyDTO.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/business/auth/service/ExternalApiKeyService.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/business/auth/service/impl/ExternalApiKeyServiceImpl.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/infrastructure/security/ExternalApiAudienceEnum.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/infrastructure/security/ExternalApiScope.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/infrastructure/security/ExternalApiPrincipal.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/infrastructure/security/ExternalApiRequestContext.java`
- Test: `bootstrap/src/test/java/com/nageoffer/ai/ragent/external/business/auth/ExternalApiKeyServiceTest.java`

- [ ] **Step 1: 写 Key 生成和摘要存储测试**

```java
@Test
void 创建Key只持久化摘要并只返回一次明文() {
    CreatedExternalApiKeyDTO created = service.create(CreateExternalApiKeyCommand.builder()
            .name("Agent read key")
            .audience(ExternalApiAudienceEnum.AGENT)
            .scopes(Set.of(ExternalApiScope.KNOWLEDGE_READ, ExternalApiScope.RETRIEVAL_EXECUTE))
            .knowledgeBaseIds(Set.of("hr"))
            .build());

    assertThat(created.getPlaintextKey()).startsWith("rag_");
    ExternalApiKeyDO stored = repo.findById(created.getId());
    assertThat(stored.getKeyHash()).hasSize(64);
    assertThat(stored.getKeyHash()).doesNotContain(created.getPlaintextKey());
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `mvn -pl bootstrap -Dtest=ExternalApiKeyServiceTest test`

Expected: FAIL，提示 Key 服务和持久化类型不存在。

- [ ] **Step 3: 添加数据表和最小实现**

```sql
CREATE TABLE t_external_api_key (
    id varchar(64) PRIMARY KEY,
    name varchar(128) NOT NULL,
    key_prefix varchar(16) NOT NULL,
    key_hash char(64) NOT NULL UNIQUE,
    audience varchar(32) NOT NULL,
    scopes_json jsonb NOT NULL,
    knowledge_base_ids_json jsonb NOT NULL,
    enabled smallint NOT NULL DEFAULT 1,
    expires_at timestamp NULL,
    last_used_at timestamp NULL,
    created_by varchar(128) NOT NULL,
    updated_by varchar(128) NOT NULL,
    create_time timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted smallint NOT NULL DEFAULT 0
);
CREATE INDEX idx_external_api_key_prefix ON t_external_api_key (key_prefix, enabled, deleted);
```

明文格式固定为 `rag_<32字节Base64URL>`；服务端使用常量时间比较 SHA-256 摘要。创建、轮换接口只在当前调用中返回明文，此后查询只返回 `keyPrefix`、audience、scope、范围和状态。

- [ ] **Step 4: 运行 Key 服务测试**

Run: `mvn -pl bootstrap -Dtest=ExternalApiKeyServiceTest test`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add sql/postgresql bootstrap/src/main/java/com/nageoffer/ai/ragent/external bootstrap/src/test/java/com/nageoffer/ai/ragent/external
git commit -m "feat: add scoped external API keys"
```

### Task 3: 实现认证拦截器、scope/audience/知识库范围校验和管理员 Key 管理入口

**Files:**
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/infrastructure/security/ExternalApiKeyInterceptor.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/infrastructure/security/ExternalRagAccessPolicy.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/admin/ExternalApiKeyAdminController.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/admin/request/ExternalApiKeyCreateRequest.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/admin/assembler/ExternalApiKeyAdminAssembler.java`
- Modify: `bootstrap/src/main/java/com/nageoffer/ai/ragent/user/config/SaTokenConfig.java`
- Test: `bootstrap/src/test/java/com/nageoffer/ai/ragent/external/infrastructure/security/ExternalApiKeyInterceptorTest.java`
- Test: `bootstrap/src/test/java/com/nageoffer/ai/ragent/external/infrastructure/security/ExternalRagAccessPolicyTest.java`

- [ ] **Step 1: 写认证和 fail-closed 权限测试**

```java
@Test
void agentKey不能执行写操作且越权知识库整体失败() {
    ExternalApiPrincipal principal = principal(AGENT,
            Set.of(KNOWLEDGE_READ, RETRIEVAL_EXECUTE), Set.of("hr"));

    assertThatThrownBy(() -> policy.requireScope(principal, INGESTION_WRITE))
            .extracting("code").isEqualTo("RAG_AUTH_FAILED");
    assertThatThrownBy(() -> policy.requireKnowledgeBases(principal, Set.of("hr", "finance")))
            .extracting("code").isEqualTo("RAG_KB_FORBIDDEN");
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `mvn -pl bootstrap -Dtest=ExternalApiKeyInterceptorTest,ExternalRagAccessPolicyTest test`

Expected: FAIL。

- [ ] **Step 3: 实现认证链和 SaToken 排除规则**

外部业务请求使用 `Authorization: Bearer <key>`。`/health` 匿名；`/capabilities` 和业务端点由 `ExternalApiKeyInterceptor` 验证。`SaTokenConfig`、`DemoModeInterceptor` 和 `UserContextInterceptor` 排除 `/api/external/v1/**`，但管理员 Key 管理入口 `/api/external-api-keys/**` 仍由现有登录体系保护。

```java
public void requireKnowledgeBases(ExternalApiPrincipal principal, Set<String> requestedIds) {
    if (!principal.getKnowledgeBaseIds().containsAll(requestedIds)) {
        throw new ExternalRagException("RAG_KB_FORBIDDEN", HttpStatus.FORBIDDEN, false);
    }
}
```

- [ ] **Step 4: 运行安全测试**

Run: `mvn -pl bootstrap -Dtest=ExternalApiKeyInterceptorTest,ExternalRagAccessPolicyTest test`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add bootstrap/src/main/java/com/nageoffer/ai/ragent/external bootstrap/src/main/java/com/nageoffer/ai/ragent/user/config/SaTokenConfig.java bootstrap/src/test/java/com/nageoffer/ai/ragent/external
git commit -m "feat: enforce external RAG access policy"
```

### Task 4: 解耦知识库业务输入并暴露外部知识库 REST

**Files:**
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/knowledge/business/command/KnowledgeBaseCreateCommand.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/knowledge/business/command/KnowledgeBaseUpdateCommand.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/knowledge/business/dto/KnowledgeBaseDTO.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/knowledge/business/convert/KnowledgeBaseConvert.java`
- Modify: `bootstrap/src/main/java/com/nageoffer/ai/ragent/knowledge/service/KnowledgeBaseService.java`
- Modify: `bootstrap/src/main/java/com/nageoffer/ai/ragent/knowledge/service/impl/KnowledgeBaseServiceImpl.java`
- Modify: `bootstrap/src/main/java/com/nageoffer/ai/ragent/knowledge/controller/KnowledgeBaseController.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/business/knowledge/service/ExternalKnowledgeService.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/business/knowledge/service/impl/ExternalKnowledgeServiceImpl.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/knowledge/ExternalKnowledgeBaseController.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/knowledge/request/ExternalKnowledgeBaseRequest.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/knowledge/assembler/ExternalKnowledgeBaseAssembler.java`
- Test: `bootstrap/src/test/java/com/nageoffer/ai/ragent/external/interfaces/http/knowledge/ExternalKnowledgeBaseControllerTest.java`

- [ ] **Step 1: 写列表范围和写权限测试**

```java
@Test
void agent列表只返回Key允许的知识库() throws Exception {
    mockMvc.perform(get("/api/external/v1/knowledge-bases")
                    .requestAttr(PRINCIPAL_ATTRIBUTE, agentPrincipal(Set.of("hr"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items.length()").value(1))
            .andExpect(jsonPath("$.items[0].id").value("hr"));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `mvn -pl bootstrap -Dtest=ExternalKnowledgeBaseControllerTest test`

Expected: FAIL。

- [ ] **Step 3: 实现 Command/DTO 重载和外部门面**

现有页面 Controller 将 Request 通过 Assembler 转为 `KnowledgeBaseCreateCommand` / `KnowledgeBaseUpdateCommand`；外部 Controller 使用同一业务入口。`ExternalKnowledgeService` 在调用前后应用 Key 知识库范围，管理写操作要求 `MANAGEMENT + knowledge:write`。

- [ ] **Step 4: 运行知识库模块测试**

Run: `mvn -pl bootstrap -Dtest=ExternalKnowledgeBaseControllerTest test`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add bootstrap/src/main/java/com/nageoffer/ai/ragent/knowledge bootstrap/src/main/java/com/nageoffer/ai/ragent/external bootstrap/src/test/java/com/nageoffer/ai/ragent/external
git commit -m "feat: expose scoped knowledge base API"
```

### Task 5: 实现限定知识库的来源完整检索与可选重排

**Files:**
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/business/retrieval/query/ExternalRetrievalQuery.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/business/retrieval/command/ExternalRerankCommand.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/business/retrieval/dto/RetrievalHitDTO.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/business/retrieval/dto/ExternalRetrievalResultDTO.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/business/retrieval/service/ExternalRetrievalService.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/business/retrieval/service/impl/ExternalRetrievalServiceImpl.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/retrieval/ExternalRetrievalController.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/retrieval/request/ExternalRetrievalRequest.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/retrieval/request/ExternalRerankRequest.java`
- Test: `bootstrap/src/test/java/com/nageoffer/ai/ragent/external/business/retrieval/ExternalRetrievalServiceTest.java`

- [ ] **Step 1: 写限定 collection、来源保留和重排降级测试**

```java
@Test
void 只检索请求知识库并同时返回原始与最终结果() {
    ExternalRetrievalResultDTO result = service.search(query(Set.of("hr"), true));

    verify(retrieverService).retrieve(argThat(r -> r.getCollectionName().equals("kb_hr")));
    verifyNoMoreInteractions(retrieverService);
    assertThat(result.getRawResults().get(0).getDocumentId()).isEqualTo("doc-1");
    assertThat(result.getResults()).hasSize(1);
    assertThat(result.getTimings().getTotalMs()).isGreaterThanOrEqualTo(0);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `mvn -pl bootstrap -Dtest=ExternalRetrievalServiceTest test`

Expected: FAIL。

- [ ] **Step 3: 实现按知识库 collection 并行检索和来源装配**

每个 `knowledgeBaseId` 先解析 `KnowledgeBaseDO.collectionName`，再独立调用 `RetrieverService.retrieve(RetrieveRequest)`；禁止调用 `VectorGlobalSearchChannel`。按 chunk ID 批量读取 `KnowledgeChunkDO` 和 `KnowledgeDocumentDO`，构建：

```java
@Getter
@Builder
public class RetrievalHitDTO {
    private final String knowledgeBaseId;
    private final String documentId;
    private final String documentName;
    private final String chunkId;
    private final String content;
    private final Float score;
    private final String source;
    private final Map<String, Object> metadata;
    private final Integer rankBefore;
    private final Integer rankAfter;
}
```

响应固定同时返回 `rawResults` 和 `results`。重排异常时 `results=rawResults.subList(0, topN)` 并加入 `RAG_RERANK_UNAVAILABLE` warning；认证、范围或协议错误不得降级。

- [ ] **Step 4: 运行检索测试**

Run: `mvn -pl bootstrap -Dtest=ExternalRetrievalServiceTest test`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add bootstrap/src/main/java/com/nageoffer/ai/ragent/external bootstrap/src/test/java/com/nageoffer/ai/ragent/external
git commit -m "feat: add scoped external retrieval"
```

### Task 6: 解耦文档上传入口并建立外部入库任务模型

**Files:**
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/knowledge/business/command/UploadKnowledgeDocumentCommand.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/knowledge/business/dto/KnowledgeDocumentDTO.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/knowledge/business/convert/KnowledgeDocumentConvert.java`
- Modify: `bootstrap/src/main/java/com/nageoffer/ai/ragent/knowledge/service/KnowledgeDocumentService.java`
- Modify: `bootstrap/src/main/java/com/nageoffer/ai/ragent/knowledge/service/impl/KnowledgeDocumentServiceImpl.java`
- Modify: `bootstrap/src/main/java/com/nageoffer/ai/ragent/knowledge/controller/KnowledgeDocumentController.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/persistence/ingestion/model/ExternalIngestionJobDO.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/persistence/ingestion/mapper/ExternalIngestionJobMapper.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/persistence/ingestion/repo/ExternalIngestionJobRepo.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/persistence/ingestion/repo/impl/ExternalIngestionJobRepoImpl.java`
- Modify: `sql/postgresql/migrations/v1.2-to-v1.3.sql`
- Modify: `sql/postgresql/schema.sql`
- Test: `bootstrap/src/test/java/com/nageoffer/ai/ragent/external/business/ingestion/ExternalIngestionJobRepoTest.java`

- [ ] **Step 1: 写任务状态和幂等唯一性测试**

```java
@Test
void 同一Key和幂等键只创建一个任务() {
    ExternalIngestionJobDO first = repo.createIfAbsent(job("key-1", "idem-1"));
    ExternalIngestionJobDO second = repo.createIfAbsent(job("key-1", "idem-1"));
    assertThat(second.getId()).isEqualTo(first.getId());
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `mvn -pl bootstrap -Dtest=ExternalIngestionJobRepoTest test`

Expected: FAIL。

- [ ] **Step 3: 添加任务表和传输无关上传命令**

`t_external_ingestion_job` 保存 `document_id`、`api_key_id`、`idempotency_key`、状态、阶段、进度、错误码、错误信息、retryable、源文件引用和父任务 ID；唯一索引为 `(api_key_id, operation, idempotency_key, deleted)`。上传命令持有 `InputStream`、文件名、MIME、大小和处理参数，业务层不得依赖 `MultipartFile`。

- [ ] **Step 4: 运行任务持久化测试**

Run: `mvn -pl bootstrap -Dtest=ExternalIngestionJobRepoTest test`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add sql/postgresql bootstrap/src/main/java/com/nageoffer/ai/ragent/knowledge bootstrap/src/main/java/com/nageoffer/ai/ragent/external bootstrap/src/test/java/com/nageoffer/ai/ragent/external
git commit -m "feat: add external ingestion jobs"
```

### Task 7: 实现文件流式上传、202、轮询、重试和删除

**Files:**
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/business/ingestion/service/ExternalIngestionService.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/business/ingestion/service/impl/ExternalIngestionServiceImpl.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/ingestion/ExternalDocumentController.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/ingestion/ExternalIngestionJobController.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/ingestion/response/AcceptedIngestionResponse.java`
- Test: `bootstrap/src/test/java/com/nageoffer/ai/ragent/external/interfaces/http/ingestion/ExternalDocumentControllerTest.java`
- Test: `bootstrap/src/test/java/com/nageoffer/ai/ragent/external/business/ingestion/ExternalIngestionServiceTest.java`

- [ ] **Step 1: 写 202、活动任务冲突、重试和删除保护测试**

```java
@Test
void 上传立即返回202和文档任务标识() throws Exception {
    mockMvc.perform(multipart("/api/external/v1/knowledge-bases/hr/documents/upload")
                    .file(new MockMultipartFile("file", "policy.md", "text/markdown", "content".getBytes()))
                    .header("Idempotency-Key", "idem-1")
                    .requestAttr(PRINCIPAL_ATTRIBUTE, managementPrincipal(Set.of("hr"))))
            .andExpect(status().isAccepted())
            .andExpect(jsonPath("$.documentId").isNotEmpty())
            .andExpect(jsonPath("$.jobId").isNotEmpty())
            .andExpect(jsonPath("$.status").value("PENDING"));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `mvn -pl bootstrap -Dtest=ExternalDocumentControllerTest,ExternalIngestionServiceTest test`

Expected: FAIL。

- [ ] **Step 3: 实现异步编排**

上传校验扩展名、MIME、大小和 scope 后，将流交给现有 `FileStorageService`，在同一事务创建文档和外部任务，再调用现有 `KnowledgeDocumentService.startChunk(documentId)` 投递 RocketMQ。查询任务时将文档 `pending/running/success/failed` 映射为外部 `PENDING/RUNNING/SUCCEEDED/FAILED`。重试仅允许失败任务，从已保存源文件创建新 job；删除遇到活动任务返回 `RAG_DOCUMENT_BUSY`。

- [ ] **Step 4: 运行入库测试**

Run: `mvn -pl bootstrap -Dtest=ExternalDocumentControllerTest,ExternalIngestionServiceTest test`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add bootstrap/src/main/java/com/nageoffer/ai/ragent/external bootstrap/src/test/java/com/nageoffer/ai/ragent/external
git commit -m "feat: expose asynchronous document ingestion"
```

### Task 8: 实现 URL 入库的 SSRF 防护

**Files:**
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/infrastructure/client/ExternalUrlImportProperties.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/infrastructure/client/SafeUrlFetcher.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/infrastructure/client/UrlTargetPolicy.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/ingestion/request/ImportDocumentUrlRequest.java`
- Modify: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/business/ingestion/service/impl/ExternalIngestionServiceImpl.java`
- Modify: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/ingestion/ExternalDocumentController.java`
- Modify: `bootstrap/src/main/resources/application.yaml`
- Test: `bootstrap/src/test/java/com/nageoffer/ai/ragent/external/infrastructure/client/UrlTargetPolicyTest.java`

- [ ] **Step 1: 写协议、私网、DNS 重绑定和重定向测试**

```java
@ParameterizedTest
@ValueSource(strings = {"file:///etc/passwd", "http://127.0.0.1/a", "http://169.254.169.254/latest/meta-data"})
void 默认拒绝非Http和内网目标(String url) {
    assertThatThrownBy(() -> policy.validate(URI.create(url)))
            .extracting("code").isEqualTo("RAG_AUTH_FAILED");
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `mvn -pl bootstrap -Dtest=UrlTargetPolicyTest test`

Expected: FAIL。

- [ ] **Step 3: 实现逐跳校验下载器**

仅允许 `http/https`；解析全部 A/AAAA 地址并拒绝 loopback、link-local、site-local、multicast、unspecified；每次重定向重新解析和校验；限制端口、重定向 3 次、连接 5 秒、读取 30 秒、响应 25 MiB，并按 capabilities MIME 白名单验收。HTTP 客户端关闭自动重定向，跨 Origin 时绝不转发 Authorization。

- [ ] **Step 4: 运行 SSRF 测试**

Run: `mvn -pl bootstrap -Dtest=UrlTargetPolicyTest test`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add bootstrap/src/main/java/com/nageoffer/ai/ragent/external bootstrap/src/main/resources/application.yaml bootstrap/src/test/java/com/nageoffer/ai/ragent/external
git commit -m "feat: secure URL document imports"
```

### Task 9: 补齐文档列表、详情、Chunk、状态和删除 REST 契约

**Files:**
- Modify: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/ingestion/ExternalDocumentController.java`
- Modify: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/ingestion/ExternalIngestionJobController.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/ingestion/response/ExternalDocumentResponse.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/ingestion/response/ExternalIngestionJobResponse.java`
- Create: `bootstrap/src/main/java/com/nageoffer/ai/ragent/external/interfaces/http/ingestion/response/ExternalChunkResponse.java`
- Test: `bootstrap/src/test/java/com/nageoffer/ai/ragent/external/interfaces/http/ingestion/ExternalDocumentQueryControllerTest.java`

- [ ] **Step 1: 写分页、范围和状态响应测试**

```java
@Test
void 文档详情和Chunk均校验所属知识库范围() throws Exception {
    mockMvc.perform(get("/api/external/v1/documents/doc-finance")
                    .requestAttr(PRINCIPAL_ATTRIBUTE, managementPrincipal(Set.of("hr"))))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("RAG_KB_FORBIDDEN"));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `mvn -pl bootstrap -Dtest=ExternalDocumentQueryControllerTest test`

Expected: FAIL。

- [ ] **Step 3: 实现完整查询契约**

列表响应使用 `items/page/pageSize/total`；job 响应包含 `status/stage/progress/retryable/startedAt/completedAt/error`；Chunk 响应只含 ID、序号、内容、字符数和 token 数，不返回内部向量或存储地址。

- [ ] **Step 4: 运行文档查询测试**

Run: `mvn -pl bootstrap -Dtest=ExternalDocumentQueryControllerTest test`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add bootstrap/src/main/java/com/nageoffer/ai/ragent/external bootstrap/src/test/java/com/nageoffer/ai/ragent/external
git commit -m "feat: complete external document API"
```

### Task 10: 加固日志、审计、协议测试和模块文档

**Files:**
- Create: `docs/external-rag-api.md`
- Create: `docs/adr/2026-07-18-external-rag-api.md`
- Create: `bootstrap/src/test/java/com/nageoffer/ai/ragent/external/ExternalRagSecurityRegressionTest.java`
- Create: `bootstrap/src/test/java/com/nageoffer/ai/ragent/external/ExternalRagContractRegressionTest.java`

- [ ] **Step 1: 写敏感信息、audience 和 HTTP 状态回归测试**

```java
@Test
void 错误响应和日志不包含明文Key() {
    String plaintext = "rag_super_secret_value";
    CapturedOutput output = invokeWithInvalidKey(plaintext);
    assertThat(output.getAll()).doesNotContain(plaintext);
    assertThat(lastResponseBody()).doesNotContain(plaintext);
}
```

- [ ] **Step 2: 运行外部模块全量测试确认新增测试先失败**

Run: `mvn -pl bootstrap -Dtest='com.nageoffer.ai.ragent.external.**' test`

Expected: FAIL，直到日志脱敏和全部端点状态映射完成。

- [ ] **Step 3: 完成审计与文档**

文档列出所有端点、请求/响应、错误码、API Key 创建和轮换流程、scope/audience、知识库范围、幂等规则、SSRF 边界和部署前检查。管理写操作、认证失败和权限拒绝记录 Key ID 前缀、动作、对象、结果和 TraceId，不记录明文 Key 或文档正文。

- [ ] **Step 4: 执行模块与构建回归**

Run: `mvn -pl bootstrap -Dtest='com.nageoffer.ai.ragent.external.**' test`

Expected: PASS。

Run: `mvn -pl bootstrap -am test`

Expected: BUILD SUCCESS。

Run: `mvn spotless:check`

Expected: BUILD SUCCESS。

- [ ] **Step 5: 提交**

```bash
git add docs bootstrap/src/test/java/com/nageoffer/ai/ragent/external
git commit -m "test: harden external RAG API contract"
```

## Final verification

- [ ] `GET /api/external/v1/health` 匿名且只返回存活状态。
- [ ] `capabilities` 与全部业务端点必须认证。
- [ ] 管理 Key 和 Agent Key audience 互斥，Agent Key 无写能力。
- [ ] 任一知识库越权导致整体请求失败，不静默过滤检索请求。
- [ ] 检索只访问显式知识库对应 collection，并返回 `rawResults`、`results`、来源和耗时。
- [ ] 上传和 URL 导入返回 `202 + documentId + jobId`，支持轮询和失败重试。
- [ ] URL 导入逐跳执行 SSRF 防护。
- [ ] 明文 Key 不进入数据库、日志和错误响应。
- [ ] `mvn -pl bootstrap -am test` 与 `mvn spotless:check` 通过。
