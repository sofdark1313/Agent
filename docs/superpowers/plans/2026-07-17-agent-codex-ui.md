# Agent Codex-Style Desktop UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the desktop client as Agent and rebuild every user-facing surface around a restrained Codex-style application shell while preserving all existing capabilities and data contracts.

**Architecture:** Keep the existing Tauri commands, chat runtime, sidebar store, project state, settings persistence, and tool registries intact. Introduce shared Agent design tokens and brand primitives first, then reshape the existing sidebar, task workspace, contextual right dock, settings, Skills, MCP, and editor overlays around those primitives. UI source-inspection tests protect the new shell contracts, while the existing functional tests protect behavior.

**Tech Stack:** Tauri 2, React 19, TypeScript, Tailwind CSS 4, Base UI, Iconify/Lucide icons, Node test runner, Biome, Vite.

---

## File structure and responsibilities

- `crates/agent-gui/src/components/brand/AgentMark.tsx`: reusable monochrome Agent mark.
- `crates/agent-gui/src/components/brand/brand.ts`: visible brand constants without changing compatibility identifiers.
- `crates/agent-gui/src/components/app-shell/AgentAppMenu.tsx`: bottom-left application menu for settings, theme, updates, and about.
- `crates/agent-gui/src/index.css`: Agent light/dark tokens, shell metrics, shared surface classes, responsive rules, and removal of decorative legacy effects.
- `crates/agent-gui/src/components/chat/ChatHistorySidebar.tsx`: global navigation, projects, recent tasks, Skills/MCP entry points, and app menu placement.
- `crates/agent-gui/src/pages/chat/components/ChatHeader.tsx`: compact project/task/model/status toolbar.
- `crates/agent-gui/src/pages/chat/components/ChatComposerBar.tsx`: restrained floating task composer.
- `crates/agent-gui/src/pages/chat/transcript/*`: document-flow messages, task empty state, and compact message actions.
- `crates/agent-gui/src/components/project-tools/*`: shared contextual dock styling and responsive drawer behavior.
- `crates/agent-gui/src/pages/SettingsPage.tsx`: Agent-style two-column settings shell.
- `crates/agent-gui/src/components/hub/HubChrome.tsx`: shared management surface for Skills and MCP.
- `crates/agent-gui/src/pages/skills-hub/SkillsHubPage.tsx`: restrained Skills management visuals.
- `crates/agent-gui/src/pages/mcp-hub/McpHubPage.tsx`: restrained MCP management visuals.
- `crates/agent-gui/src/components/workspace-editor/*Overlay.tsx`: consistent editor workspace chrome.
- `crates/agent-gui/test/ui/agent-shell.test.mjs`: source-level shell, token, responsive, and branding contracts.
- `crates/agent-gui/src-tauri/icons/*`: generated Agent desktop icon set.
- `crates/agent-gui/src-tauri/tauri*.conf.json`, `crates/agent-gui/index.html`, `crates/agent-gui/src/i18n/config.ts`: visible Agent branding.

### Task 1: Add brand contracts and the Agent mark

**Files:**
- Create: `crates/agent-gui/test/ui/agent-shell.test.mjs`
- Create: `crates/agent-gui/src/components/brand/brand.ts`
- Create: `crates/agent-gui/src/components/brand/AgentMark.tsx`
- Modify: `crates/agent-gui/src/components/icons.tsx`

- [ ] **Step 1: Write the failing brand contract test**

Create a Node test that reads source files and asserts the stable visible brand and SVG contract:

```js
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/ui/agent-shell.test.mjs`

Expected: FAIL because the brand files do not exist.

- [ ] **Step 3: Implement the visible brand primitives**

Add constants in `brand.ts`:

```ts
export const APP_NAME = "Agent";
export const APP_SHORT_NAME = "Agent";
export const APP_DESCRIPTION = "A focused desktop workspace for coding agents.";
```

Add `AgentMark.tsx` as a 32×32 SVG with two mirrored path strokes and a rectangular terminal-cursor negative-space treatment. The component accepts `className`, `title`, and `decorative`; decorative marks use `aria-hidden`, titled marks use `role="img"`.

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test test/ui/agent-shell.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the brand primitives**

```bash
git add crates/agent-gui/test/ui/agent-shell.test.mjs crates/agent-gui/src/components/brand crates/agent-gui/src/components/icons.tsx
git commit -m "feat(ui): add Agent brand primitives"
```

### Task 2: Establish the Agent design system and shell metrics

**Files:**
- Modify: `crates/agent-gui/src/index.css`
- Modify: `crates/agent-gui/src/components/ui/button.tsx`
- Modify: `crates/agent-gui/src/components/ui/input.tsx`
- Modify: `crates/agent-gui/src/components/ui/textarea.tsx`
- Modify: `crates/agent-gui/test/ui/agent-shell.test.mjs`

- [ ] **Step 1: Add failing token and responsive assertions**

Extend the test with assertions for these exact tokens and contracts:

```js
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/ui/agent-shell.test.mjs`

Expected: FAIL on missing Agent CSS tokens.

- [ ] **Step 3: Replace the global palette and shared control metrics**

Define neutral light/dark values for `--background`, `--foreground`, `--muted`, `--border`, chat surfaces, and new `--agent-*` tokens. Set the sidebar to 260px, top bar to 44px, content width to 780px, dock default to 420px, 6–14px radii, and soft menu/dialog shadows. Update base controls to use 8px radii, visible focus rings, and restrained hover states.

Add shared classes:

```css
.agent-shell { background: hsl(var(--agent-canvas)); }
.agent-sidebar { width: var(--agent-sidebar-width); background: hsl(var(--agent-sidebar)); }
.agent-topbar { min-height: var(--agent-topbar-height); }
.agent-floating-surface { border: 1px solid hsl(var(--border) / 0.72); box-shadow: var(--agent-shadow-float); }
.agent-nav-item[data-active="true"] { background: hsl(var(--foreground) / 0.065); color: hsl(var(--foreground)); }
```

Add responsive rules at 1100px and 900px so the dock becomes an overlay and navigation can be presented as a drawer. Preserve all existing reduced-motion rules.

- [ ] **Step 4: Run focused tests and lint**

Run: `node --test test/ui/agent-shell.test.mjs && pnpm biome check src/components/ui src/index.css`

Expected: PASS with no Biome errors.

- [ ] **Step 5: Commit the design system**

```bash
git add crates/agent-gui/src/index.css crates/agent-gui/src/components/ui crates/agent-gui/test/ui/agent-shell.test.mjs
git commit -m "feat(ui): establish Agent design system"
```

### Task 3: Rebuild the global sidebar and application menu

**Files:**
- Create: `crates/agent-gui/src/components/app-shell/AgentAppMenu.tsx`
- Modify: `crates/agent-gui/src/components/chat/ChatHistorySidebar.tsx`
- Modify: `crates/agent-gui/src/pages/chat/sidebar/ChatSidebarContainer.tsx`
- Modify: `crates/agent-gui/src/pages/ChatPage.tsx`
- Modify: `crates/agent-gui/test/ui/agent-shell.test.mjs`

- [ ] **Step 1: Add failing navigation contract assertions**

```js
test("global sidebar exposes task, project, management, and app-menu regions", () => {
  const sidebar = read("src/components/chat/ChatHistorySidebar.tsx");
  assert.match(sidebar, /data-agent-sidebar/);
  assert.match(sidebar, /data-agent-nav="new-task"/);
  assert.match(sidebar, /data-agent-nav="skills"/);
  assert.match(sidebar, /data-agent-nav="mcp"/);
  assert.match(sidebar, /AgentAppMenu/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/ui/agent-shell.test.mjs`

Expected: FAIL on missing sidebar regions.

- [ ] **Step 3: Implement the compact global navigation**

Replace the current logo header with the small `AgentMark`, a compact `Agent` label, a 32px new-task row, and the existing close control. Keep project/recent virtualization and mutations unchanged. Move Skills/MCP into a management navigation block below recent tasks. Replace the bottom settings row with `AgentAppMenu`, which contains settings, theme, update, and about actions while reusing existing callbacks.

Use `data-agent-sidebar` and `data-agent-nav` attributes from the test. Keep the existing `isOpen` width transition but use `var(--agent-sidebar-width)` instead of hard-coded 272px.

- [ ] **Step 4: Run sidebar and existing state tests**

Run: `node --test test/ui/agent-shell.test.mjs test/chat/sidebar-*.test.mjs test/settings/workspace-projects.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the shell navigation**

```bash
git add crates/agent-gui/src/components/app-shell crates/agent-gui/src/components/chat/ChatHistorySidebar.tsx crates/agent-gui/src/pages/chat/sidebar/ChatSidebarContainer.tsx crates/agent-gui/src/pages/ChatPage.tsx crates/agent-gui/test/ui/agent-shell.test.mjs
git commit -m "feat(ui): rebuild Agent global navigation"
```

### Task 4: Recompose the task workspace, transcript, and composer

**Files:**
- Modify: `crates/agent-gui/src/pages/chat/components/ChatHeader.tsx`
- Modify: `crates/agent-gui/src/pages/chat/components/ChatComposerBar.tsx`
- Modify: `crates/agent-gui/src/pages/chat/transcript/ChatTranscript.tsx`
- Modify: `crates/agent-gui/src/pages/chat/transcript/ChatEmptyState.tsx`
- Modify: `crates/agent-gui/src/pages/chat/transcript/UserMessageRow.tsx`
- Modify: `crates/agent-gui/src/pages/chat/transcript/AssistantRow.tsx`
- Modify: `crates/agent-gui/src/pages/chat/components/AssistantBubble.tsx`
- Modify: `crates/agent-gui/test/ui/agent-shell.test.mjs`

- [ ] **Step 1: Add failing workspace contracts**

```js
test("task workspace uses compact topbar, document transcript, and floating composer", () => {
  assert.match(read("src/pages/chat/components/ChatHeader.tsx"), /data-agent-topbar/);
  assert.match(read("src/pages/chat/transcript/ChatTranscript.tsx"), /data-agent-transcript/);
  assert.match(read("src/pages/chat/components/ChatComposerBar.tsx"), /data-agent-composer/);
  assert.match(read("src/pages/chat/transcript/ChatEmptyState.tsx"), /data-agent-empty-state/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/ui/agent-shell.test.mjs`

Expected: FAIL on missing task workspace attributes.

- [ ] **Step 3: Implement the Codex-style task workspace**

Make the header a 44px border-bottom toolbar with sidebar toggle, task/project context, model selector, status, settings fallback, and right-dock toggle. Remove glass-heavy dropdown decorations.

Set transcript content to `max-width: var(--agent-content-width)`, reduce user bubble radius and contrast, preserve selectable assistant document flow, and keep message actions keyboard-accessible.

Replace the empty-state aura and colored suggestion cards with `AgentMark`, a concise greeting, recent-project/task actions, and neutral suggestion rows.

Make the composer an opaque/near-opaque floating surface with 14px radius, one subtle border, restrained shadow, and a clear two-row hierarchy. Preserve attachment, Skills, search, reasoning, queue, send, and stop behavior.

- [ ] **Step 4: Run chat behavior tests and build**

Run: `node --test test/ui/agent-shell.test.mjs test/chat/*.test.mjs && pnpm build`

Expected: all tests PASS and Vite build completes.

- [ ] **Step 5: Commit the task workspace**

```bash
git add crates/agent-gui/src/pages/chat crates/agent-gui/test/ui/agent-shell.test.mjs
git commit -m "feat(ui): reshape the Agent task workspace"
```

### Task 5: Unify the contextual tool dock and editor overlays

**Files:**
- Modify: `crates/agent-gui/src/components/project-tools/RightDockPanel.tsx`
- Modify: `crates/agent-gui/src/components/project-tools/RightDockTabStrip.tsx`
- Modify: `crates/agent-gui/src/components/project-tools/RightDockLauncher.tsx`
- Modify: `crates/agent-gui/src/components/project-tools/RightDockContent.tsx`
- Modify: `crates/agent-gui/src/components/workspace-editor/WorkspaceCodeEditorOverlay.tsx`
- Modify: `crates/agent-gui/src/components/workspace-editor/WorkspaceFilePreviewOverlay.tsx`
- Modify: `crates/agent-gui/src/components/workspace-editor/WorkspaceImagePreviewOverlay.tsx`
- Modify: `crates/agent-gui/src/components/workspace-editor/WorkspaceSshTerminalOverlay.tsx`
- Modify: `crates/agent-gui/test/settings/right-dock-model.test.mjs`
- Modify: `crates/agent-gui/test/ui/agent-shell.test.mjs`

- [ ] **Step 1: Add failing dock presentation assertions**

Assert `data-agent-context-dock`, `data-agent-dock-tabs`, and `data-agent-editor-workspace` exist, and that CSS contains an overlay rule below 1100px.

- [ ] **Step 2: Run focused tests and verify the new assertions fail**

Run: `node --test test/ui/agent-shell.test.mjs test/settings/right-dock-model.test.mjs`

Expected: UI contract FAIL; right-dock model tests continue to PASS.

- [ ] **Step 3: Implement shared contextual-tool chrome**

Keep registry, tabs, sessions, widths, and project persistence unchanged. Restyle the dock with a neutral background, compact 36px tab row, active underline/background, one border-left, and an overlay/backdrop mode at medium widths. Recompose editor overlays into a consistent header/content/footer workspace and apply `data-agent-editor-workspace` to each root.

- [ ] **Step 4: Run dock, terminal, Git, and build checks**

Run: `node --test test/ui/agent-shell.test.mjs test/settings/right-dock-model.test.mjs test/tools/terminal-tools.test.mjs test/tools/ssh-manager-tools.test.mjs test/tools/tunnel-manager-tools.test.mjs test/tools/git-graph.test.mjs && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit contextual tools**

```bash
git add crates/agent-gui/src/components/project-tools crates/agent-gui/src/components/workspace-editor crates/agent-gui/test
git commit -m "feat(ui): unify Agent contextual tools"
```

### Task 6: Rebuild Settings as a unified management surface

**Files:**
- Modify: `crates/agent-gui/src/pages/SettingsPage.tsx`
- Modify: `crates/agent-gui/src/pages/settings/shared.tsx`
- Modify: `crates/agent-gui/src/pages/settings/*.tsx`
- Modify: `crates/agent-gui/test/ui/agent-shell.test.mjs`

- [ ] **Step 1: Add failing settings shell assertions**

```js
test("settings uses Agent management navigation and content regions", () => {
  const settings = read("src/pages/SettingsPage.tsx");
  assert.match(settings, /data-agent-settings/);
  assert.match(settings, /data-agent-settings-nav/);
  assert.match(settings, /data-agent-settings-content/);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test test/ui/agent-shell.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement the settings management shell**

Use a 220px neutral navigation rail, 44px content header, a maximum readable form width, shared section headings, 8–12px radii, and inline save/error state. Remove colored icon tiles and high-decoration cards. Preserve every section component and save flow. Add a narrow-window category selector/drawer without changing section IDs.

- [ ] **Step 4: Run settings tests and build**

Run: `node --test test/ui/agent-shell.test.mjs test/settings/*.test.mjs && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit settings**

```bash
git add crates/agent-gui/src/pages/SettingsPage.tsx crates/agent-gui/src/pages/settings crates/agent-gui/test/ui/agent-shell.test.mjs
git commit -m "feat(ui): rebuild Agent settings"
```

### Task 7: Unify Skills and MCP management pages

**Files:**
- Modify: `crates/agent-gui/src/components/hub/HubChrome.tsx`
- Modify: `crates/agent-gui/src/pages/skills-hub/SkillsHubPage.tsx`
- Modify: `crates/agent-gui/src/pages/mcp-hub/McpHubPage.tsx`
- Modify: `crates/agent-gui/src/index.css`
- Modify: `crates/agent-gui/test/ui/agent-shell.test.mjs`

- [ ] **Step 1: Add failing management-page assertions**

Assert the shared hub root uses `data-agent-management`, and scan the three files to ensure legacy `hub-frost-hero`, `hero-aura`, and decorative gradient-title classes are absent from active markup.

- [ ] **Step 2: Run and verify failure**

Run: `node --test test/ui/agent-shell.test.mjs`

Expected: FAIL because legacy hub markup remains.

- [ ] **Step 3: Implement the shared management surface**

Rework `HubChrome` into a compact title/action header plus scrollable content canvas. Convert Skills and MCP filters to neutral segmented controls, list/detail layouts, compact status badges, and direct empty/error guidance. Retain all install, enable, refresh, registry, connection, import, and drawer behavior. Remove decorative frosted loading surfaces and staggered card entrances from active UI.

- [ ] **Step 4: Run Skills/MCP tests and build**

Run: `node --test test/ui/agent-shell.test.mjs test/skills/*.test.mjs test/settings/mcp-ops.test.mjs test/tools/mcp-*.test.mjs && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit management pages**

```bash
git add crates/agent-gui/src/components/hub crates/agent-gui/src/pages/skills-hub crates/agent-gui/src/pages/mcp-hub crates/agent-gui/src/index.css crates/agent-gui/test/ui/agent-shell.test.mjs
git commit -m "feat(ui): unify Agent management pages"
```

### Task 8: Apply visible rebrand and generate desktop icons

**Files:**
- Modify: `crates/agent-gui/src/i18n/config.ts`
- Modify: `crates/agent-gui/src/components/WindowsTitleBar.tsx`
- Modify: `crates/agent-gui/src/components/chat/ChatHistorySidebar.tsx`
- Modify: `crates/agent-gui/src/pages/chat/transcript/ChatEmptyState.tsx`
- Modify: `crates/agent-gui/src/pages/ChatPage.tsx`
- Modify: `crates/agent-gui/index.html`
- Modify: `crates/agent-gui/src-tauri/tauri.conf.json`
- Modify: `crates/agent-gui/src-tauri/tauri.windows.conf.json`
- Modify: `crates/agent-gui/src-tauri/tauri.windows.release.conf.json`
- Modify: `crates/agent-gui/src-tauri/tauri.macos.conf.json`
- Modify: `crates/agent-gui/src-tauri/tauri.macos.release.conf.json`
- Replace: `crates/agent-gui/src-tauri/icons/*`
- Modify: `crates/agent-gui/test/ui/agent-shell.test.mjs`

- [ ] **Step 1: Add failing visible-brand assertions**

Read the HTML, Tauri config, Windows title bar, sidebar, empty state, and i18n files. Assert the visible title is Agent and visible `LiveAgent`/`Live Agent` strings are absent, while compatibility identifiers such as `com.xiaofei.liveagent`, storage keys, MIME types, protocol headers, and Rust type names are explicitly excluded from this test.

- [ ] **Step 2: Run and verify failure**

Run: `node --test test/ui/agent-shell.test.mjs`

Expected: FAIL on current visible brand strings.

- [ ] **Step 3: Replace visible brand text and imagery**

Use `APP_NAME` in React surfaces. Update Chinese and English user-visible copy, HTML title, Tauri `productName`, window titles, Cargo description, and about-page labels to Agent. Do not rename package names, identifiers, persisted storage keys, debug directories, proxy headers, MIME types, protocol events, or Rust compatibility types.

Create a 1024px transparent master PNG from the Agent SVG and run Tauri icon generation to replace standard, Windows, and macOS assets. Preserve the filenames referenced by existing platform configs.

- [ ] **Step 4: Run brand test, build, and backend release smoke tests**

Run: `node --test test/ui/agent-shell.test.mjs test/backend/release-*.test.mjs && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit the rebrand**

```bash
git add crates/agent-gui/src crates/agent-gui/index.html crates/agent-gui/src-tauri crates/agent-gui/test/ui/agent-shell.test.mjs
git commit -m "feat(ui): rebrand desktop app as Agent"
```

### Task 9: Complete regression, responsive, and visual verification

**Files:**
- Update: `crates/agent-gui/test/ui/agent-shell.test.mjs`
- Verify: `crates/agent-gui/src/index.css`
- Verify: `crates/agent-gui/src/components/chat/ChatHistorySidebar.tsx`
- Verify: `crates/agent-gui/src/pages/chat/components/ChatHeader.tsx`
- Verify: `crates/agent-gui/src/pages/chat/components/ChatComposerBar.tsx`
- Verify: `crates/agent-gui/src/components/project-tools/RightDockPanel.tsx`
- Verify: `crates/agent-gui/src/pages/SettingsPage.tsx`
- Verify: `crates/agent-gui/src/pages/skills-hub/SkillsHubPage.tsx`
- Verify: `crates/agent-gui/src/pages/mcp-hub/McpHubPage.tsx`

- [ ] **Step 1: Run the complete frontend test suite**

Run: `pnpm test:frontend`

Expected: all tests PASS.

- [ ] **Step 2: Run lint and production build**

Run: `pnpm lint && pnpm build`

Expected: no Biome errors; TypeScript and Vite build complete.

- [ ] **Step 3: Start the desktop/web preview and inspect critical states**

Run: `pnpm dev --host 127.0.0.1`

Inspect at widths 1440, 1050, and 760 pixels in both themes:

- empty task;
- active transcript with user, assistant, tool call, code, and Diff;
- sidebar project and recent-task sections;
- open contextual dock with files, Git, and terminal tabs;
- Settings sections;
- Skills and MCP management pages;
- menus, dialogs, error banners, and focus states.

Expected: no horizontal overflow, clipped actions, unreadable contrast, oversized radii, decorative legacy hero effects, or inaccessible controls.

- [ ] **Step 4: Verify desktop chrome and brand assets**

Run: `pnpm tauri build --debug --no-bundle`

Expected: debug desktop build succeeds; Agent window title and icon appear correctly. On the available platform, verify minimize/maximize/close and draggable regions. Confirm macOS configuration retains native titlebar spacing by source inspection if macOS is unavailable.

- [ ] **Step 5: Run final diff and compatibility checks**

Run: `git diff --check && rg -n 'LiveAgent|Live Agent' crates/agent-gui/src crates/agent-gui/index.html crates/agent-gui/src-tauri/tauri*.conf.json`

Expected: no whitespace errors. Any remaining old-name occurrence must be a documented compatibility identifier, internal protocol term, persisted storage key, debug directory, or bundled Skill documentation—not visible application branding.

- [ ] **Step 6: Commit final polish**

```bash
git add crates/agent-gui
git commit -m "fix(ui): polish Agent responsive workspace"
```

## Plan self-review

- Spec coverage: brand, icon, light/dark tokens, shell layout, navigation, task workspace, contextual tools, settings, Skills, MCP, overlays, accessibility, responsive states, and verification each map to a task.
- Compatibility: package names, identifiers, storage keys, debug paths, MIME types, proxy headers, events, protocols, and Rust types are intentionally preserved unless purely user-visible.
- Testing: each implementation batch begins with a failing source contract and ends with focused existing behavior tests; the final task runs the complete frontend suite, lint, web build, and desktop build.
- Scope: no backend protocol or Agent runtime redesign is included.
