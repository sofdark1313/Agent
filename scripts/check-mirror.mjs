#!/usr/bin/env node
// Verifies that files listed in scripts/mirror-manifest.json are byte-identical
// between the desktop GUI and gateway WebUI source trees.
//
// Usage: node scripts/check-mirror.mjs [--list]
//   --list  print every checked pair instead of only failures

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repoRoot, "scripts", "mirror-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const listMode = process.argv.includes("--list");

const guiRoot = join(repoRoot, manifest.guiRoot);
const webRoot = join(repoRoot, manifest.webRoot);

let failures = 0;

for (const relPath of manifest.files) {
  const guiPath = join(guiRoot, relPath);
  const webPath = join(webRoot, relPath);
  let guiBytes = null;
  let webBytes = null;
  try {
    guiBytes = readFileSync(guiPath);
  } catch {
    // handled below
  }
  try {
    webBytes = readFileSync(webPath);
  } catch {
    // handled below
  }

  if (guiBytes === null || webBytes === null) {
    failures += 1;
    if (guiBytes === null) console.error(`MISSING  ${manifest.guiRoot}/${relPath}`);
    if (webBytes === null) console.error(`MISSING  ${manifest.webRoot}/${relPath}`);
    continue;
  }

  if (!guiBytes.equals(webBytes)) {
    failures += 1;
    console.error(`DRIFT    ${relPath}`);
    console.error(`         diff "${manifest.guiRoot}/${relPath}" "${manifest.webRoot}/${relPath}"`);
    continue;
  }

  if (listMode) console.log(`OK       ${relPath}`);
}

if (failures > 0) {
  console.error(`\nmirror check failed: ${failures} of ${manifest.files.length} file(s) drifted or missing.`);
  console.error("Mirrored files must be byte-identical on both ends; platform differences go in adapter files.");
  process.exit(1);
}

console.log(`mirror check passed (${manifest.files.length} file(s)).`);
