import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("RAG Hub is reachable from the global sidebar and exposes management workflows", () => {
  const pagePath = path.join(root, "src/pages/rag-hub/RagHubPage.tsx");
  assert.equal(fs.existsSync(pagePath), true);
  const page = read("src/pages/rag-hub/RagHubPage.tsx");
  const documentPanel = read("src/pages/rag-hub/RagDocumentPanel.tsx");
  const ragHubSources = `${page}\n${documentPanel}`;
  const translations = read("src/i18n/config.ts");
  const chat = read("src/pages/ChatPage.tsx");
  const sidebar = read("src/components/chat/ChatHistorySidebar.tsx");

  assert.match(sidebar, /data-agent-nav="rag"/);
  assert.match(chat, /"rag-hub"/);
  assert.match(chat, /<RagHubPage/);
  assert.match(page, /data-agent-rag-hub/);
  assert.match(page, /rag_save_service/);
  assert.match(page, /rag_hub_list_knowledge_bases/);
  assert.match(page, /rag_hub_create_knowledge_base/);
  assert.match(page, /rag_hub_update_knowledge_base/);
  assert.match(page, /rag_hub_delete_knowledge_base/);
  assert.match(page, /t\("ragHub\.knowledgeBase\.createHint"\)/);
  assert.match(translations, /knowledgeBaseIds=\[\\?"\*\\?"\]/);
  assert.match(ragHubSources, /rag_hub_upload_document/);
  assert.match(ragHubSources, /rag_hub_import_document_url/);
  assert.match(ragHubSources, /rag_pick_document_file/);
  assert.match(ragHubSources, /rag_hub_get_ingestion_job/);
  assert.match(ragHubSources, /rag_hub_list_ingestion_jobs/);
  assert.match(ragHubSources, /rag_hub_retry_ingestion_job/);
  assert.match(ragHubSources, /rag_hub_delete_document/);
  assert.match(ragHubSources, /rag_hub_list_document_chunks/);
  assert.match(page, /rag_hub_search/);
  assert.match(page, /DEFAULT_RAGENT_BASE_URL/);
  assert.doesNotMatch(page, /http:\/\/localhost:8080/);
  assert.doesNotMatch(ragHubSources, /JSON\.stringify\(documents/);
});

test("RAG Hub invoke payloads preserve snake_case arguments and camelCase request fields", () => {
  const page = read("src/pages/rag-hub/RagHubPage.tsx");
  const documentPanel = read("src/pages/rag-hub/RagDocumentPanel.tsx");
  const rerankModel = read("src/pages/rag-hub/rerankModel.ts");
  const serviceState = read("src/pages/rag-hub/serviceState.ts");
  const invokeCommands = (source) =>
    [...source.matchAll(/\binvoke(?:<[^\n(]+>)?\("([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(invokeCommands(page), [
    "rag_list_services",
    "rag_list_services",
    "rag_save_service",
    "rag_prompt_service_credential",
    "rag_clear_service_credential",
    "rag_delete_service",
    "rag_test_service",
    "rag_hub_list_knowledge_bases",
    "rag_hub_create_knowledge_base",
    "rag_hub_update_knowledge_base",
    "rag_hub_delete_knowledge_base",
    "rag_hub_search",
    "rag_hub_rerank",
  ]);
  assert.deepEqual(invokeCommands(documentPanel), [
    "rag_hub_list_documents",
    "rag_hub_list_ingestion_jobs",
    "rag_pick_document_file",
    "rag_hub_get_ingestion_job",
    "rag_hub_upload_document",
    "rag_hub_import_document_url",
    "rag_hub_retry_ingestion_job",
    "rag_hub_delete_document",
    "rag_hub_list_document_chunks",
  ]);

  assert.equal(
    page.match(/invoke<RagService\[\]>\("rag_list_services"\)/g)?.length,
    2,
  );
  assert.match(
    page,
    /"rag_save_service", \{\s*request: \{\s*service: draft,?\s*\},?\s*\}\)/,
  );
  assert.doesNotMatch(serviceState, /managementApiKey|agentApiKey|buildRagCredentialUpdate/);
  assert.match(
    page,
    /"rag_prompt_service_credential", \{\s*service_id: selectedId,\s*credential_kind: kind,?\s*\}/,
  );
  assert.match(
    page,
    /"rag_clear_service_credential", \{\s*service_id: selectedId,\s*credential_kind: kind,?\s*\}/,
  );
  assert.match(page, /"rag_delete_service", \{\s*service_id: selectedId\s*\}\)/);
  assert.match(page, /"rag_test_service", \{\s*service_id: draft\.id,?\s*\}\)/);
  assert.match(
    page,
    /"rag_hub_list_knowledge_bases", \{\s*service_id: selectedId \|\| undefined,?\s*\}\)/,
  );
  assert.match(
    page,
    /"rag_hub_create_knowledge_base", \{\s*service_id: selectedId \|\| undefined,\s*name: payload\.name,\s*embedding_model: payload\.embeddingModel,\s*collection_name: payload\.collectionName,?\s*\}\)/,
  );
  assert.match(
    page,
    /"rag_hub_update_knowledge_base", \{\s*service_id: selectedId \|\| undefined,\s*knowledge_base_id: selectedKnowledgeBase\.id,\s*name: knowledgeBaseName\.trim\(\),?\s*\}\)/,
  );
  assert.match(
    page,
    /"rag_hub_delete_knowledge_base", \{\s*service_id: selectedId \|\| undefined,\s*knowledge_base_id: selectedKnowledgeBase\.id,?\s*\}\)/,
  );
  assert.match(
    documentPanel,
    /"rag_hub_list_documents", \{\s*service_id: serviceId,\s*knowledge_base_id: knowledgeBaseId,\s*current: 1,\s*size: 50,?\s*\}\)/,
  );
  assert.match(
    documentPanel,
    /"rag_hub_list_ingestion_jobs", \{\s*service_id: serviceId,\s*document_id: document\.id,\s*current: 1,\s*size: 20,?\s*\}\)/,
  );
  assert.match(documentPanel, /hydrateRagIngestionHistory/);
  assert.match(documentPanel, /jobState\.history/);
  assert.match(
    documentPanel,
    /invoke<RagPickedDocumentFile \| null>\("rag_pick_document_file", \{\s*service_id: serviceId,?\s*\}\)/,
  );
  assert.match(
    documentPanel,
    /"rag_hub_upload_document", \{\s*service_id: serviceId,\s*knowledge_base_id: knowledgeBaseId,\s*file_path: selectedFile\.path,\s*ingestion: ingestionRequest,?\s*\}\)/,
  );
  assert.match(
    documentPanel,
    /"rag_hub_import_document_url", \{\s*service_id: serviceId,\s*knowledge_base_id: knowledgeBaseId,\s*document_url: url,\s*ingestion: ingestionRequest,?\s*\}\)/,
  );
  assert.match(
    documentPanel,
    /"rag_hub_get_ingestion_job", \{\s*service_id: serviceId,\s*job_id: jobId,?\s*\}\)/,
  );
  assert.match(
    documentPanel,
    /"rag_hub_retry_ingestion_job", \{\s*service_id: serviceId,\s*job_id: retryJobId,?\s*\}\)/,
  );
  assert.doesNotMatch(documentPanel, /job_id: documentId/);
  assert.match(documentPanel, /jobsByDocumentId/);
  assert.match(documentPanel, /retryJobIdForDocument/);
  assert.match(
    documentPanel,
    /"rag_hub_delete_document", \{\s*service_id: serviceId,\s*document_id: document\.id,?\s*\}\)/,
  );
  assert.match(
    documentPanel,
    /"rag_hub_list_document_chunks", \{\s*service_id: serviceId,\s*document_id: documentId,\s*current: 1,\s*size: 100,?\s*\}\)/,
  );
  assert.match(
    page,
    /"rag_hub_search", \{\s*request: \{\s*serviceId: selectedId \|\| undefined,\s*query: query\.trim\(\),\s*knowledgeBaseIds: searchKnowledgeBaseIds,\s*topK: effectiveSearchSettings\.topK,\s*rerank: effectiveSearchSettings\.rerank,\s*topN: effectiveSearchSettings\.topN,?\s*\},?\s*\}\)/,
  );
  assert.match(
    page,
    /"rag_hub_rerank", \{\s*request: buildRagRerankRequest\(\{\s*serviceId: selectedId \|\| undefined,\s*query,\s*hits: rerankCandidates,\s*topN: effectiveSearchSettings\.topN,\s*capabilities: draft\.capabilitiesSnapshot,?\s*\}\),?\s*\}\)/,
  );

  const rerankInvoke = page.match(
    /invoke<RagSearchResponse>\("rag_hub_rerank", \{[\s\S]*?\n\s+\}\);/,
  )?.[0];
  assert.ok(rerankInvoke, "rag_hub_rerank must use one top-level request argument");
  assert.doesNotMatch(
    rerankInvoke,
    /\b(?:service_id|knowledge_base_id|document_id|document_name|chunk_id|top_n)\s*:/,
  );
  assert.match(
    rerankModel,
    /return \{\s*knowledgeBaseId,\s*documentId: optionalTrimmed\(hit\.documentId\),\s*documentName: optionalTrimmed\(hit\.documentName\),\s*chunkId,\s*content: hit\.content,\s*score: hit\.score,\s*source,\s*metadata: hit\.metadata \?\? \{\},?\s*\};/,
  );
  assert.doesNotMatch(rerankModel, /\brankBefore\s*:/);
  assert.doesNotMatch(rerankModel, /\brankAfter\s*:/);
});

test("RAG document ingestion is entirely capability-driven", () => {
  const page = read("src/pages/rag-hub/RagHubPage.tsx");
  const documentPanel = read("src/pages/rag-hub/RagDocumentPanel.tsx");
  const gateway = read("src-tauri/src/services/rag/gateway.rs");

  assert.match(page, /ingestionSettings=\{ingestionSettings\}/);
  assert.match(documentPanel, /createDefaultRagIngestionSelection/);
  assert.match(documentPanel, /validateRagIngestionSelection/);
  assert.match(documentPanel, /validateRagPickedDocument/);
  assert.match(documentPanel, /processMode/);
  assert.match(documentPanel, /chunkStrategy/);
  assert.match(documentPanel, /chunkConfig/);
  assert.match(documentPanel, /pipelineId/);
  assert.doesNotMatch(gateway, /\.text\("processMode",\s*"chunk"\)/);
  assert.doesNotMatch(gateway, /\.text\("chunkStrategy",\s*"fixed_size"\)/);
  assert.doesNotMatch(gateway, /chunkSize\\?":512/);
  assert.match(page, /nextRagCapabilityExpiryDelay/);
  assert.match(page, /setTimeout\(.*capability/s);
});

test("RAG credentials never enter React state, inputs, or IPC payloads", () => {
  const page = read("src/pages/rag-hub/RagHubPage.tsx");
  const serviceState = read("src/pages/rag-hub/serviceState.ts");
  const source = `${page}\n${serviceState}`;

  assert.doesNotMatch(source, /managementApiKey|agentApiKey/);
  assert.doesNotMatch(source, /type="password"/);
  assert.doesNotMatch(source, /buildRagCredentialUpdate/);
  assert.match(page, /rag_prompt_service_credential/);
  assert.match(page, /rag_clear_service_credential/);
  assert.match(page, /managementCredentialConfigured/);
  assert.match(page, /agentCredentialConfigured/);
});

test("RAG search experiment compares retrieval and reranked results with diagnostics", () => {
  const page = read("src/pages/rag-hub/RagHubPage.tsx");

  assert.match(page, /rawResults/);
  assert.match(page, /warnings/);
  assert.match(page, /timings/);
  assert.match(page, /t\("ragHub\.search\.rawResults"\)/);
  assert.match(page, /t\("ragHub\.search\.finalResults"\)/);
  assert.match(page, /documentName/);
  assert.match(page, /rankBefore/);
  assert.match(page, /rankAfter/);
  assert.match(page, /searchKnowledgeBaseIds/);
  assert.match(page, /searchTopK/);
  assert.match(page, /searchRerank/);
  assert.match(page, /searchTopN/);
  assert.match(page, /maxQueryLength/);
  assert.match(page, /aria-pressed/);
});

test("RAG Hub reranks the current candidate snapshot without replacing search results", () => {
  const page = read("src/pages/rag-hub/RagHubPage.tsx");

  assert.match(page, /const \[rerankResponse, setRerankResponse\] = useState<RagSearchResponse \| null>/);
  assert.match(page, /const \[rerankCandidateSnapshot, setRerankCandidateSnapshot\] = useState<RagSearchHit\[\]>/);
  assert.match(
    page,
    /const \[resultView, setResultView\] = useState<"search" \| "rerank">\("search"\)/,
  );
  assert.match(
    page,
    /const rerankCandidates =\s*returnedRawResults\.length > 0 \? returnedRawResults : finalResults;/,
  );
  assert.match(
    page,
    /const canRerankCurrentCandidates =\s*rerankCandidates\.length > 0 &&\s*Boolean\(query\.trim\(\)\) &&\s*searchLimits\.rerankSupported &&\s*!busy;/,
  );

  const rerankFunction = page.match(
    /async function rerankCurrentCandidates\(\) \{[\s\S]*?\n  \}/,
  )?.[0];
  assert.ok(rerankFunction, "rerankCurrentCandidates must be declared");
  assert.match(rerankFunction, /run\("rerank"/);
  assert.match(rerankFunction, /setRerankCandidateSnapshot\(rerankCandidates\)/);
  assert.match(rerankFunction, /setRerankResponse\(/);
  assert.match(rerankFunction, /setResultView\("rerank"\)/);
  assert.doesNotMatch(rerankFunction, /setSearchResponse\(/);

  assert.ok(
    (page.match(/setRerankResponse\(null\)/g) ?? []).length >= 2,
    "switching service and starting a new search must clear independent rerank state",
  );
  assert.match(page, /t\("ragHub\.search\.rerankCandidates"\)/);
  assert.match(page, /t\("ragHub\.search\.rerankingCandidates"\)/);
  assert.match(page, /disabled=\{!canRerankCurrentCandidates\}/);
  assert.match(page, /t\("ragHub\.search\.results"\)/);
  assert.match(page, /t\("ragHub\.search\.rerankedResults"\)/);
  assert.match(page, /t\("ragHub\.search\.candidateInput"\)/);
  assert.match(
    page,
    /<fieldset[\s\S]*?<legend className="sr-only">\s*\{t\("ragHub\.search\.resultViewLegend"\)\}\s*<\/legend>/,
  );
  assert.match(page, /rerankResponse \? \(/);
  assert.match(page, /rerankResponse\.requestId/);
  assert.match(page, /rerankResponse\.timings/);
  assert.match(page, /rerankWarnings/);
});

test("RAG Hub discards stale independent rerank completions after context changes", () => {
  const page = read("src/pages/rag-hub/RagHubPage.tsx");

  assert.match(page, /useCallback, useEffect, useMemo, useRef, useState/);
  assert.match(page, /const rerankRequestTokenRef = useRef\(0\);/);
  assert.match(
    page,
    /useEffect\(\(\) => \{\s*rerankRequestTokenRef\.current \+= 1;[\s\S]*?\}, \[selected\]\);/,
  );

  const searchFunction = page.match(/async function searchKnowledge\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(searchFunction, "searchKnowledge must be declared");
  assert.match(searchFunction, /rerankRequestTokenRef\.current \+= 1;/);

  const rerankFunction = page.match(
    /async function rerankCurrentCandidates\(\) \{[\s\S]*?\n  \}/,
  )?.[0];
  assert.ok(rerankFunction, "rerankCurrentCandidates must be declared");
  assert.match(
    rerankFunction,
    /const requestToken = \+\+rerankRequestTokenRef\.current;/,
  );
  assert.ok(
    (rerankFunction.match(/requestToken !== rerankRequestTokenRef\.current/g) ?? []).length >=
      2,
    "resolved and rejected stale rerank requests must both be discarded",
  );

  const responseIndex = rerankFunction.indexOf("const response = await invoke");
  const guardIndex = rerankFunction.indexOf(
    "if (requestToken !== rerankRequestTokenRef.current) return;",
  );
  const snapshotIndex = rerankFunction.indexOf("setRerankCandidateSnapshot");
  const responseStateIndex = rerankFunction.indexOf("setRerankResponse");
  const resultViewIndex = rerankFunction.indexOf('setResultView("rerank")');
  const noticeIndex = rerankFunction.indexOf("setNotice");
  assert.ok(responseIndex >= 0 && guardIndex > responseIndex);
  for (const stateIndex of [snapshotIndex, responseStateIndex, resultViewIndex, noticeIndex]) {
    assert.ok(stateIndex > guardIndex, "all rerank completion writes must follow the token guard");
  }
});

test("RAG Hub exposes accessible feedback, query labeling, and busy announcements", () => {
  const page = read("src/pages/rag-hub/RagHubPage.tsx");

  assert.doesNotMatch(page, /\{error \|\| notice \? \(/);
  assert.match(
    page,
    /\{error \? \(\s*<div\s*role="alert"\s*aria-live="assertive"[\s\S]*?\{error\}/,
  );
  assert.match(
    page,
    /\) : notice \? \(\s*<div\s*role="status"\s*aria-live="polite"[\s\S]*?\{notice\}/,
  );
  assert.match(
    page,
    /<Label htmlFor="rag-search-query" className="sr-only">\s*\{t\("ragHub\.search\.queryLabel"\)\}\s*<\/Label>/,
  );
  assert.match(page, /<Textarea\s*id="rag-search-query"/);
  assert.match(
    page,
    /onClick=\{searchKnowledge\}\s*aria-busy=\{busy === "search"\}/,
  );
  assert.match(
    page,
    /onClick=\{rerankCurrentCandidates\}\s*aria-busy=\{busy === "rerank"\}/,
  );
  assert.match(
    page,
    /className="sr-only"\s*role="status"\s*aria-live="polite"/,
  );
  assert.match(page, /t\("ragHub\.search\.searchingAnnouncement"\)/);
  assert.match(page, /t\("ragHub\.search\.rerankingAnnouncement"\)/);
});

test("RAG Hub user-facing copy is provided by the locale layer", () => {
  const page = read("src/pages/rag-hub/RagHubPage.tsx");
  const documentPanel = read("src/pages/rag-hub/RagDocumentPanel.tsx");
  const sidebar = read("src/components/chat/ChatHistorySidebar.tsx");

  assert.match(page, /import \{ useLocale \} from "\.\.\/\.\.\/i18n"/);
  assert.match(documentPanel, /import \{ useLocale \} from "\.\.\/\.\.\/i18n"/);
  assert.match(page, /const \{ t \} = useLocale\(\)/);
  assert.match(documentPanel, /const \{ t \} = useLocale\(\)/);
  assert.match(sidebar, /data-agent-nav="rag"[\s\S]*?title=\{t\("ragHub\.navTitle"\)\}/);
  assert.doesNotMatch(page, /[\u3400-\u9fff]/u);
  assert.doesNotMatch(documentPanel, /[\u3400-\u9fff]/u);
});

test("RAG Hub discards stale search completions after the request context changes", () => {
  const page = read("src/pages/rag-hub/RagHubPage.tsx");
  const searchFunction = page.match(/async function searchKnowledge\(\) \{[\s\S]*?\n  \}/)?.[0];

  assert.ok(searchFunction, "searchKnowledge must be declared");
  assert.match(
    searchFunction,
    /rerankRequestTokenRef\.current \+= 1;\s*const requestToken = rerankRequestTokenRef\.current;/,
  );
  assert.ok(
    (searchFunction.match(/requestToken !== rerankRequestTokenRef\.current/g) ?? []).length >=
      2,
    "resolved and rejected stale searches must both be discarded",
  );

  const responseIndex = searchFunction.indexOf("const response = await invoke");
  const guardIndex = searchFunction.indexOf(
    "if (requestToken !== rerankRequestTokenRef.current) return;",
  );
  const responseStateIndex = searchFunction.indexOf("setSearchResponse({");
  assert.ok(responseIndex >= 0 && guardIndex > responseIndex);
  assert.ok(responseStateIndex > guardIndex, "search response writes must follow the token guard");
});

test("RAG Hub invalidates in-flight results before query or Top N edits", () => {
  const page = read("src/pages/rag-hub/RagHubPage.tsx");

  assert.match(
    page,
    /onChange=\{\(event\) => \{\s*rerankRequestTokenRef\.current \+= 1;\s*setQuery\(event\.target\.value\);\s*\}\}/,
  );
  assert.match(
    page,
    /onChange=\{\(event\) => \{\s*rerankRequestTokenRef\.current \+= 1;\s*setSearchTopN\(Number\(event\.target\.value\)\);\s*\}\}/,
  );
});

test("RAG service cards expose credentials, protocol, and capability health", () => {
  const page = read("src/pages/rag-hub/RagHubPage.tsx");

  assert.match(page, /resolveRagCapabilityHealth/);
  assert.match(
    page,
    /resolveRagCapabilityHealth\(\s*service\.capabilitiesSnapshot,\s*capabilityNowMs,?\s*\)/,
  );
  assert.match(page, /ragHub\.service\.managementCredential/);
  assert.match(page, /ragHub\.service\.agentCredential/);
  assert.match(page, /ragHub\.service\.protocolVersion/);
  assert.match(page, /ragHub\.service\.capabilityStatus\./);
});

test("RAG service editor exposes fixed adapter and validated timeout controls", () => {
  const page = read("src/pages/rag-hub/RagHubPage.tsx");

  assert.match(page, /id="rag-service-adapter"/);
  assert.match(page, /<option value="ragent">ragent<\/option>/);
  assert.match(page, /id="rag-service-timeout"/);
  assert.match(page, /min=\{MIN_RAG_SERVICE_TIMEOUT_MS\}/);
  assert.match(page, /max=\{MAX_RAG_SERVICE_TIMEOUT_MS\}/);
  assert.match(page, /isValidRagServiceTimeout\(draft\.timeoutMs\)/);
  assert.match(page, /t\("ragHub\.service\.timeoutInvalid"\)/);
});

test("RAG knowledge bases can be searched and toggled in the Agent allowlist locally", () => {
  const page = read("src/pages/rag-hub/RagHubPage.tsx");

  assert.match(page, /const \[knowledgeBaseQuery, setKnowledgeBaseQuery\] = useState\(""\)/);
  assert.match(page, /filterRagKnowledgeBases\(knowledgeBases, knowledgeBaseQuery\)/);
  assert.match(page, /placeholder=\{t\("ragHub\.knowledgeBase\.searchPlaceholder"\)\}/);
  assert.match(page, /function toggleAgentKnowledgeBase\(knowledgeBaseId: string\)/);
  assert.match(
    page,
    /agentKnowledgeBaseIds: toggleRagKnowledgeBase\(current\.agentKnowledgeBaseIds, knowledgeBaseId\)/,
  );
  assert.match(page, /aria-pressed=\{allowedForAgent\}/);
  assert.match(page, /t\("ragHub\.knowledgeBase\.allowlistSaveRetest"\)/);
});
