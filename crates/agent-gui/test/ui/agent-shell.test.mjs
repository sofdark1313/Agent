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

test("Agent shell defines neutral themes and responsive panel contracts", () => {
  const css = read("src/index.css");

  assert.match(css, /--agent-sidebar:/);
  assert.match(css, /--agent-canvas:/);
  assert.match(css, /--agent-surface-raised:/);
  assert.match(css, /--agent-sidebar-width: 260px/);
  assert.match(css, /--agent-topbar-height: 44px/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("global sidebar exposes task, project, management, and app-menu regions", () => {
  const sidebar = read("src/components/chat/ChatHistorySidebar.tsx");

  assert.match(sidebar, /data-agent-sidebar/);
  assert.match(sidebar, /data-agent-nav="new-task"/);
  assert.match(sidebar, /data-agent-nav="skills"/);
  assert.match(sidebar, /data-agent-nav="mcp"/);
  assert.match(sidebar, /AgentAppMenu/);
});

test("task workspace uses compact topbar, document transcript, and floating composer", () => {
  assert.match(read("src/pages/chat/components/ChatHeader.tsx"), /data-agent-topbar/);
  assert.match(read("src/pages/chat/transcript/ChatTranscript.tsx"), /data-agent-transcript/);
  assert.match(read("src/pages/chat/components/ChatComposerBar.tsx"), /data-agent-composer/);
  assert.match(read("src/pages/chat/transcript/ChatEmptyState.tsx"), /data-agent-empty-state/);
});

test("context tools and editor overlays share Agent workspace chrome", () => {
  assert.match(read("src/components/project-tools/RightDockPanel.tsx"), /data-agent-context-dock/);
  assert.match(read("src/components/project-tools/RightDockTabStrip.tsx"), /data-agent-dock-tabs/);
  assert.match(
    read("src/components/workspace-editor/WorkspaceCodeEditorOverlay.tsx"),
    /data-agent-editor-workspace/,
  );
});

test("settings uses Agent management navigation and content regions", () => {
  const settings = read("src/pages/SettingsPage.tsx");

  assert.match(settings, /data-agent-settings/);
  assert.match(settings, /data-agent-settings-nav/);
  assert.match(settings, /data-agent-settings-content/);
});

test("Skills and MCP share the restrained Agent management chrome", () => {
  const hub = read("src/components/hub/HubChrome.tsx");

  assert.match(hub, /data-agent-management/);
  assert.doesNotMatch(hub, /radial-gradient/);
  assert.match(hub, /rounded-xl border/);
});
