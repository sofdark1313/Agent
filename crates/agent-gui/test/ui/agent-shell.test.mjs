import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const readTree = (directory) =>
  fs
    .readdirSync(path.join(root, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"))
    .join("\n");

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

test("sidebar app menu does not render the bottom update button", () => {
  const appMenu = read("src/components/app-shell/AgentAppMenu.tsx");

  assert.doesNotMatch(appMenu, /AppUpdateButton/);
  assert.doesNotMatch(appMenu, /showUpdateButton/);
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

test("settings follows the flat Codex document and neutral control model", () => {
  const settings = read("src/pages/SettingsPage.tsx");
  const system = read("src/pages/settings/SystemSettingsForm.tsx");
  const shared = read("src/pages/settings/shared.tsx");
  const css = read("src/index.css");

  assert.match(settings, /data-agent-settings-header/);
  assert.match(settings, /data-agent-settings-body/);
  assert.match(system, /data-agent-settings-document/);
  assert.match(system, /data-agent-setting-row/);
  assert.match(system, /data-agent-segmented-control/);
  assert.doesNotMatch(system, /rounded-2xl|shadow-primary/);
  assert.doesNotMatch(shared, /sky-500/);
  assert.match(css, /\.agent-settings-option-list/);
});

test("Skills and MCP share the restrained Agent management chrome", () => {
  const hub = read("src/components/hub/HubChrome.tsx");

  assert.match(hub, /data-agent-management/);
  assert.doesNotMatch(hub, /radial-gradient/);
  assert.match(hub, /rounded-xl border/);
});

test("visible desktop branding uses Agent while compatibility identifiers stay out of scope", () => {
  const html = read("index.html");
  const tauri = read("src-tauri/tauri.conf.json");
  const titleBar = read("src/components/WindowsTitleBar.tsx");
  const locale = read("src/i18n/config.ts");

  assert.match(html, /<title>Agent<\/title>/);
  assert.match(tauri, /"productName": "Agent"/);
  assert.doesNotMatch(titleBar, /LiveAgent|Live Agent/);
  assert.doesNotMatch(locale, /"app\.name": "LiveAgent"/);
});

test("user-facing settings, tray, icons, and built-in Skills do not leak the legacy brand", () => {
  const settingsCopy = [
    read("src/pages/settings/CherryStudioImportModal.tsx"),
    read("src/pages/settings/ProvidersSection.tsx"),
  ].join("\n");
  const visibleDocuments = [
    "src-tauri/icons/liveagent-logo.svg",
  ];

  assert.doesNotMatch(
    settingsCopy,
    /模型由 LiveAgent|LiveAgent 会自动|LiveAgent 获取并激活|LiveAgent API/,
  );
  for (const file of visibleDocuments) {
    assert.doesNotMatch(read(file), /LiveAgent|Live Agent/, file);
  }
  assert.doesNotMatch(
    [
      readTree("src-tauri/prompt/skills/skills-creator"),
      readTree("src-tauri/prompt/skills/skills-installer"),
    ].join("\n"),
    /LiveAgent|Live Agent/,
  );

  assert.doesNotMatch(read("src-tauri/src/lib.rs"), /\.tooltip\("LiveAgent"\)/);
});
