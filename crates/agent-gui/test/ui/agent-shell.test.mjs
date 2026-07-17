import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Agent brand primitives are stable and independent from compatibility identifiers", () => {
  const brand = read("src/components/brand/brand.ts");
  const mark = read("src/components/brand/AgentMark.tsx");

  assert.match(brand, /APP_NAME = "Agent"/);
  assert.match(brand, /APP_SHORT_NAME = "Agent"/);
  assert.match(mark, /viewBox="0 0 32 32"/);
  assert.match(mark, /aria-hidden/);
});
