import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const legacyPattern = new RegExp(["\\blive", "[-_ ]?", "agent\\b"].join(""), "i");

function isDocumentation(file) {
  const normalized = file.replaceAll("\\", "/");
  return normalized.startsWith("docs/") || normalized.endsWith(".md");
}

test("runtime, packaging, and source identifiers use Agent exclusively", () => {
  const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .filter((file) => !isDocumentation(file));

  const legacyPaths = trackedFiles.filter((file) => legacyPattern.test(file));
  const legacyContents = [];

  for (const file of trackedFiles) {
    const content = fs.readFileSync(path.join(repositoryRoot, file));
    if (content.includes(0)) continue;
    if (legacyPattern.test(content.toString("utf8"))) legacyContents.push(file);
  }

  assert.deepEqual(legacyPaths, [], `legacy paths:\n${legacyPaths.join("\n")}`);
  assert.deepEqual(legacyContents, [], `legacy contents:\n${legacyContents.join("\n")}`);
});
