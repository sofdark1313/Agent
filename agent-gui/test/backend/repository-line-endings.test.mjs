import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

test("repository pins text files to LF for cross-platform formatter checks", async () => {
  const attributes = await readFile(path.join(repositoryRoot, ".gitattributes"), "utf8");
  assert.match(attributes, /^\* text=auto eol=lf$/m);
});
