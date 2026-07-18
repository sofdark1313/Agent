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
  const chat = read("src/pages/ChatPage.tsx");
  const sidebar = read("src/components/chat/ChatHistorySidebar.tsx");

  assert.match(sidebar, /data-agent-nav="rag"/);
  assert.match(chat, /"rag-hub"/);
  assert.match(chat, /<RagHubPage/);
  assert.match(page, /data-agent-rag-hub/);
  assert.match(page, /rag_save_service/);
  assert.match(page, /rag_hub_list_knowledge_bases/);
  assert.match(page, /rag_hub_upload_document/);
  assert.match(page, /rag_hub_search/);
});
