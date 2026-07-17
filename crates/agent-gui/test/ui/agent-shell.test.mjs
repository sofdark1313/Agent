import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Agent brand primitives are stable", () => {
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
  assert.match(sidebar, /data-agent-nav="cron"/);
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

test("chat composer follows the Codex input surface and action hierarchy", () => {
  const composer = read("src/pages/chat/components/ChatComposerBar.tsx");
  const header = read("src/pages/chat/components/ChatHeader.tsx");
  const accessSelectorPath = path.join(root, "src/pages/chat/components/ChatAccessSelector.tsx");
  assert.equal(fs.existsSync(accessSelectorPath), true, "composer access selector is required");
  const accessSelector = read("src/pages/chat/components/ChatAccessSelector.tsx");
  const modelSelectorPath = path.join(root, "src/pages/chat/components/ChatModelSelector.tsx");
  assert.equal(fs.existsSync(modelSelectorPath), true, "composer model selector component is required");
  const modelSelector = read("src/pages/chat/components/ChatModelSelector.tsx");
  const css = read("src/index.css");

  assert.match(composer, /data-agent-composer-surface/);
  assert.match(composer, /data-agent-composer-attachments/);
  assert.match(composer, /data-agent-composer-add/);
  assert.match(composer, /<ChatAccessSelector/);
  assert.match(accessSelector, /data-agent-composer-access/);
  assert.match(accessSelector, /DropdownMenuItem/);
  assert.match(accessSelector, /updateSystem/);
  assert.match(accessSelector, /executionMode/);
  assert.match(accessSelector, /onOpenSettings\("systemTools"\)/);
  assert.match(composer, /data-agent-composer-tool="upload"/);
  assert.match(composer, /data-agent-composer-tool="thinking"/);
  assert.match(composer, /data-agent-composer-tool="web-search"/);
  assert.match(composer, /DropdownMenuCheckboxItem/);
  assert.match(composer, /<ArrowUp/);
  assert.match(composer, /isAgentMode/);
  assert.match(composer, /<ChatModelSelector/);
  assert.doesNotMatch(header, /model-selector-trigger|ChatModelSelector/);
  assert.match(modelSelector, /data-agent-composer-model/);
  assert.ok(
    composer.indexOf("<GitBranchSelector") < composer.indexOf("<ChatModelSelector"),
    "model selector should follow Git controls in the composer",
  );
  assert.match(css, /\.agent-codex-composer/);
  assert.match(css, /\.agent-composer-add-menu/);
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
  assert.match(settings, /settings\.groupPersonal/);
  assert.match(settings, /settings\.groupIntegrationsCoding/);
  assert.doesNotMatch(settings, /settings\.groupOther/);
  assert.doesNotMatch(settings, /items:\s*\[\{ id: "about"/);
  assert.doesNotMatch(settings, /\{ id: "cron"/);
  assert.equal(
    fs.existsSync(path.join(root, "src/pages/cron-hub/CronHubPage.tsx")),
    true,
    "Cron Hub page is required",
  );
  assert.match(read("src/pages/cron-hub/CronHubPage.tsx"), /<CronSection/);
});

test("Windows title bar exposes functional Codex-style application menus", () => {
  const titleBar = read("src/components/WindowsTitleBar.tsx");
  const appMenu = read("src/components/app-shell/AgentAppMenu.tsx");

  assert.match(titleBar, /data-agent-window-menu=\{props\.id\}/);
  assert.match(titleBar, /<TitleBarMenu id="file"/);
  assert.match(titleBar, /<TitleBarMenu id="edit"/);
  assert.match(titleBar, /<TitleBarMenu id="view"/);
  assert.match(titleBar, /<TitleBarMenu id="help"/);
  assert.match(titleBar, /dispatchAppCommand/);
  assert.match(titleBar, /onOpenSettings.*"about"/);
  assert.doesNotMatch(appMenu, /onOpenSettings\("about"\)/);
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

test("desktop package and visible surfaces consistently use the Agent brand", () => {
  const html = read("index.html");
  const tauri = read("src-tauri/tauri.conf.json");
  const cargo = read("src-tauri/Cargo.toml");
  const titleBar = read("src/components/WindowsTitleBar.tsx");
  const locale = read("src/i18n/config.ts");
  const tray = read("src-tauri/src/lib.rs");
  const logo = read("src-tauri/icons/agent-logo.svg");

  assert.match(html, /<title>Agent<\/title>/);
  assert.match(tauri, /"productName": "Agent"/);
  assert.match(tauri, /"identifier": "com\.xiaofei\.agent"/);
  assert.match(cargo, /name = "agent"/);
  assert.match(cargo, /name = "agent_lib"/);
  assert.match(titleBar, /<AgentMark/);
  assert.match(titleBar, /t\("app\.name"\)/);
  assert.match(locale, /"app\.name": "Agent"/);
  assert.match(tray, /\.tooltip\("Agent"\)/);
  assert.match(logo, /aria-label="Agent logo"/);
});

test("user-facing provider import copy uses the Agent brand", () => {
  const settingsCopy = [
    read("src/pages/settings/CherryStudioImportModal.tsx"),
    read("src/pages/settings/ProvidersSection.tsx"),
  ].join("\n");

  assert.match(settingsCopy, /模型由 Agent 获取并激活/);
  assert.match(settingsCopy, /Agent 会自动读取 Cherry Studio 的数据目录设置/);
  assert.match(settingsCopy, /Agent API 未返回可用模型/);
});
