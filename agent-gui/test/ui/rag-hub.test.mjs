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
  assert.match(page, /knowledgeBaseIds=\["\*"\]/);
  assert.match(ragHubSources, /rag_hub_upload_document/);
  assert.match(ragHubSources, /rag_hub_import_document_url/);
  assert.match(ragHubSources, /rag_pick_document_file/);
  assert.match(ragHubSources, /rag_hub_get_ingestion_job/);
  assert.match(ragHubSources, /rag_hub_retry_ingestion_job/);
  assert.match(ragHubSources, /rag_hub_delete_document/);
  assert.match(ragHubSources, /rag_hub_list_document_chunks/);
  assert.match(page, /rag_hub_search/);
  assert.doesNotMatch(ragHubSources, /JSON\.stringify\(documents/);
});

test("RAG search experiment compares retrieval and reranked results with diagnostics", () => {
  const page = read("src/pages/rag-hub/RagHubPage.tsx");

  assert.match(page, /rawResults/);
  assert.match(page, /warnings/);
  assert.match(page, /timings/);
  assert.match(page, /原始召回/);
  assert.match(page, /最终结果/);
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
