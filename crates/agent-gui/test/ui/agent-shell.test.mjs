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
  const sidebarContainer = read("src/pages/chat/sidebar/ChatSidebarContainer.tsx");

  assert.match(sidebar, /data-agent-sidebar/);
  assert.match(sidebar, /headerModeSelector/);
  assert.match(sidebarContainer, /<ChatModeSelector/);
  assert.match(sidebarContainer, /headerModeSelector=/);
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
  assert.doesNotMatch(appMenu, /settings\.appearance/);
  assert.doesNotMatch(appMenu, /onToggleTheme/);
  assert.doesNotMatch(appMenu, /\bMoon\b|\bSun\b/);
});

test("top-right theme control only offers explicit light and dark targets", () => {
  const header = read("src/pages/chat/components/ChatHeader.tsx");

  assert.match(header, /resolveEffectiveTheme\(settings\.theme\)/);
  assert.match(header, /getNextTheme\(settings\.theme\)/);
  assert.match(header, /<ThemeToggleIcon theme=\{effectiveTheme\}/);
  assert.match(header, /tooltip\.switchToLight/);
  assert.match(header, /tooltip\.switchToDark/);
  assert.doesNotMatch(header, /MonitorSmartphone/);
  assert.doesNotMatch(header, /tooltip\.switchToAuto/);
});

test("task workspace uses compact topbar, document transcript, and floating composer", () => {
  assert.match(read("src/pages/chat/components/ChatHeader.tsx"), /data-agent-topbar/);
  assert.match(read("src/pages/chat/transcript/ChatTranscript.tsx"), /data-agent-transcript/);
  assert.match(read("src/pages/chat/components/ChatComposerBar.tsx"), /data-agent-composer/);
  assert.match(read("src/pages/chat/transcript/ChatEmptyState.tsx"), /data-agent-empty-state/);
});

test("assistant answers use compact Codex document flow with collapsed thinking", () => {
  const bubble = read("src/pages/chat/components/AssistantBubble.tsx");
  const assistantRow = read("src/pages/chat/transcript/AssistantRow.tsx");
  const round = read("src/pages/chat/components/assistant-bubble/RoundContent.tsx");
  const transcript = read("src/pages/chat/transcript/TranscriptList.tsx");
  const css = read("src/index.css");

  assert.match(bubble, /data-agent-assistant-answer/);
  assert.doesNotMatch(bubble, /<AssistantAvatar\s*\/>/);
  assert.doesNotMatch(assistantRow, /<AssistantAvatar\s*\/>/);
  assert.match(round, /data-agent-thinking-block/);
  assert.match(round, /useState\(false\)/);
  assert.doesNotMatch(round, /autoOpenThinking|open=\{autoOpenThinking/);
  assert.match(round, /className="agent-answer-markdown"/);
  assert.match(transcript, /const TRANSCRIPT_ROW_GAP = 16/);
  assert.match(css, /\.chat-markdown \{[\s\S]*?leading-\[1\.6\]/);
  assert.match(css, /data-streamdown="code-block-body"[\s\S]*?border-0/);
  assert.match(css, /data-streamdown="code-block-actions"[\s\S]*?border: 0/);
  assert.doesNotMatch(css, /content: "STREAMING"/);
});

test("assistant answers render without first-line indentation", () => {
  const round = read("src/pages/chat/components/assistant-bubble/RoundContent.tsx");
  const utils = read("src/pages/chat/components/assistant-bubble/assistantBubbleUtils.ts");
  const css = read("src/index.css");

  assert.match(round, /normalizeAssistantLeadingIndent\(block\.text\)/);
  assert.match(utils, /export function normalizeAssistantLeadingIndent/);
  assert.match(utils, /[\\u3000\\u00a0]/i);
  assert.doesNotMatch(css, /\.agent-answer-markdown[\s\S]{0,180}text-indent/);
});

test("chat composer follows the Codex input surface and action hierarchy", () => {
  const composer = read("src/pages/chat/components/ChatComposerBar.tsx");
  const header = read("src/pages/chat/components/ChatHeader.tsx");
  const accessSelectorPath = path.join(root, "src/pages/chat/components/ChatAccessSelector.tsx");
  assert.equal(fs.existsSync(accessSelectorPath), true, "composer access selector is required");
  const accessSelector = read("src/pages/chat/components/ChatAccessSelector.tsx");
  const modeSelectorPath = path.join(root, "src/pages/chat/components/ChatModeSelector.tsx");
  assert.equal(fs.existsSync(modeSelectorPath), true, "sidebar mode selector is required");
  const modeSelector = read("src/pages/chat/components/ChatModeSelector.tsx");
  const modelSelectorPath = path.join(root, "src/pages/chat/components/ChatModelSelector.tsx");
  assert.equal(fs.existsSync(modelSelectorPath), true, "composer model selector component is required");
  const modelSelector = read("src/pages/chat/components/ChatModelSelector.tsx");
  const css = read("src/index.css");

  assert.match(composer, /data-agent-composer-surface/);
  assert.match(composer, /data-agent-composer-attachments/);
  assert.match(composer, /data-agent-composer-add/);
  assert.match(composer, /<ChatAccessSelector/);
  assert.doesNotMatch(composer, /<ChatModeSelector/);
  assert.match(modeSelector, /data-agent-sidebar-mode/);
  assert.match(modeSelector, /chat\.mode\.chatTitle/);
  assert.match(modeSelector, /chat\.mode\.agentTitle/);
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

test("conversation task list is a single collapsed panel above the composer", () => {
  const panelPath = path.join(root, "src/pages/chat/components/ConversationTodoPanel.tsx");
  assert.equal(fs.existsSync(panelPath), true, "conversation task panel is required");

  const panel = read("src/pages/chat/components/ConversationTodoPanel.tsx");
  const composer = read("src/pages/chat/components/ChatComposerBar.tsx");
  const chatPage = read("src/pages/ChatPage.tsx");

  assert.match(panel, /data-agent-conversation-todos/);
  assert.match(panel, /useState\(false\)/);
  assert.match(panel, /useSyncExternalStore/);
  assert.match(panel, /findLatestConversationTodos/);
  assert.match(composer, /taskListPanel\?: ReactNode/);
  assert.match(composer, /\{taskListPanel\}/);
  assert.match(chatPage, /<ConversationTodoPanel/);
  assert.match(chatPage, /key=\{currentConversationId\}/);
  assert.match(chatPage, /historyItems=\{historyRenderItems\}/);
  assert.match(chatPage, /liveTranscriptStore=\{liveTranscriptStore\}/);
});

test("conversation usage is maintained once above the composer", () => {
  const usagePanelPath = path.join(root, "src/pages/chat/components/ConversationUsagePanel.tsx");
  assert.equal(fs.existsSync(usagePanelPath), true, "conversation usage panel is required");

  const usagePanel = read("src/pages/chat/components/ConversationUsagePanel.tsx");
  const composer = read("src/pages/chat/components/ChatComposerBar.tsx");
  const chatPage = read("src/pages/ChatPage.tsx");
  const round = read("src/pages/chat/components/assistant-bubble/RoundContent.tsx");

  assert.match(usagePanel, /data-agent-conversation-usage/);
  assert.match(usagePanel, /useSyncExternalStore/);
  assert.match(usagePanel, /findLatestConversationUsage/);
  assert.match(composer, /usagePanel\?: ReactNode/);
  assert.match(composer, /\{usagePanel\}/);
  assert.match(chatPage, /<ConversationUsagePanel/);
  assert.match(chatPage, /show=\{isAgentDevExecutionMode\}/);
  assert.doesNotMatch(round, /<UsagePanel/);
});

test("successful TodoWrite calls stay out of the transcript message flow", () => {
  const round = read("src/pages/chat/components/assistant-bubble/RoundContent.tsx");
  const todoView = read("src/pages/chat/components/assistant-bubble/TodoListView.tsx");

  assert.doesNotMatch(round, /TodoListBlock/);
  assert.match(
    round,
    /toolCall\.name === "TodoWrite" && !block\.item\.toolResult\?\.isError\)[\s\S]*?return null/,
  );
  assert.match(
    round,
    /block\.kind === "tool"[\s\S]*?toolCall\.name === "TodoWrite"[\s\S]*?return false/,
  );
  assert.doesNotMatch(todoView, /export function TodoListBlock/);
});

test("ordinary tool activity is summarized and collapsed by default", () => {
  const group = read("src/pages/chat/components/assistant-bubble/ToolTraceGroup.tsx");
  const utils = read("src/pages/chat/components/assistant-bubble/assistantBubbleUtils.ts");

  assert.match(group, /data-agent-tool-activity/);
  assert.match(group, /useState\(false\)/);
  assert.doesNotMatch(group, /shouldAutoOpen|setOpen\(true\)/);
  assert.match(utils, /kind: "toolGroup"/);
  assert.doesNotMatch(utils, /if \(pendingTools\.length === 1\)/);
});

test("thinking disappears as soon as the active thinking phase completes", () => {
  const round = read("src/pages/chat/components/assistant-bubble/RoundContent.tsx");

  assert.match(round, /const activeThinkingBlockId/);
  assert.match(round, /isLive && isActive/);
  assert.match(
    round,
    /block\.kind === "thinking"[\s\S]*?block\.key !== activeThinkingBlockId[\s\S]*?return null/,
  );
  assert.match(
    round,
    /block\.kind === "thinking"[\s\S]*?block\.id === activeThinkingBlockId/,
  );
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
  const appCommands = read("src/lib/appCommands.ts");
  const chatPage = read("src/pages/ChatPage.tsx");
  const capability = read("src-tauri/capabilities/default.json");
  const appMenu = read("src/components/app-shell/AgentAppMenu.tsx");

  assert.match(titleBar, /data-agent-window-menu=\{props\.id\}/);
  assert.match(titleBar, /data-agent-window-menu-region/);
  assert.match(titleBar, /data-agent-window-drag-region/);
  assert.match(
    titleBar,
    /data-agent-window-drag-region[\s\S]*?onDoubleClick=\{handleTitleDoubleClick\}[\s\S]*?onMouseDown=\{startDragging\}/,
  );
  assert.doesNotMatch(titleBar, /data-agent-window-menu-region[\s\S]*?stopPropagation/);
  assert.doesNotMatch(titleBar, /event\.target[\s\S]*?closest\("button"\)/);
  assert.match(titleBar, /<TitleBarMenu\s+id="file"/);
  assert.match(titleBar, /<TitleBarMenu\s+id="edit"/);
  assert.match(titleBar, /<TitleBarMenu id="view"/);
  assert.match(titleBar, /<TitleBarMenu id="help"/);
  assert.match(titleBar, /dispatchAppCommand/);
  assert.match(titleBar, /new WebviewWindow/);
  assert.match(titleBar, /window\.menu\.newWindow/);
  assert.match(titleBar, /window\.menu\.newTask/);
  assert.match(titleBar, /window\.menu\.newProjectlessTask/);
  assert.match(titleBar, /window\.menu\.openFolder/);
  assert.match(titleBar, /window\.menu\.close/);
  assert.match(titleBar, /window\.menu\.undo/);
  assert.match(titleBar, /window\.menu\.redo/);
  assert.match(titleBar, /window\.menu\.cut/);
  assert.match(titleBar, /window\.menu\.copy/);
  assert.match(titleBar, /window\.menu\.paste/);
  assert.match(titleBar, /window\.menu\.delete/);
  assert.match(titleBar, /window\.menu\.selectAll/);
  assert.match(titleBar, /runEditCommand/);
  assert.match(appCommands, /"newProjectlessChat"/);
  assert.match(appCommands, /"openFolder"/);
  assert.match(chatPage, /case "newProjectlessChat"/);
  assert.match(chatPage, /case "openFolder"/);
  assert.match(capability, /core:webview:allow-create-webview-window/);
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
  assert.doesNotMatch(system, /settings\.executionMode/);
  assert.doesNotMatch(system, /rounded-2xl|shadow-primary/);
  assert.doesNotMatch(shared, /sky-500/);
  assert.match(css, /\.agent-settings-option-list/);
});

test("maximized settings sections fill the available content width", () => {
  const settings = read("src/pages/SettingsPage.tsx");

  assert.match(settings, /settings-section-shell w-full/);
  assert.doesNotMatch(settings, /max-w-\[780px\]/);
  assert.doesNotMatch(settings, /max-w-\[1040px\]/);
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
