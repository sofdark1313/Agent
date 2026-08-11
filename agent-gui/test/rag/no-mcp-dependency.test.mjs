import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

function collectFiles(directory, extensions) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute, extensions);
    return extensions.has(path.extname(entry.name)) ? [absolute] : [];
  });
}

test("built-in RAG implementation has no MCP protocol dependency", () => {
  const sources = [
    path.join(root, "src/lib/rag"),
    path.join(root, "src/pages/rag-hub"),
    path.join(root, "src/lib/tools/ragTools.ts"),
    path.join(root, "src-tauri/src/services/rag"),
    path.join(root, "src-tauri/src/commands/integration/rag.rs"),
  ].flatMap((entry) => {
    const stat = fs.statSync(entry);
    return stat.isDirectory()
      ? collectFiles(entry, new Set([".ts", ".tsx", ".rs"]))
      : [entry];
  });

  const forbidden = [
    /from\s+["'][^"']*mcp[^"']*["']/i,
    /use\s+[^;\n]*mcp[^;\n]*;/i,
    /mcp__[^\s"']+/i,
    /executeMcpToolCall/i,
    /McpServer/i,
  ];

  for (const source of sources) {
    const content = fs.readFileSync(source, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(
        content,
        pattern,
        `${path.relative(root, source)} must stay on the native RAG path`,
      );
    }
  }
});
