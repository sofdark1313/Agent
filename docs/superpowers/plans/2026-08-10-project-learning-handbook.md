# Agent 项目完整学习手册 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `docs/learning/` 中交付一套覆盖桌面 GUI、Tauri/Rust 后端、Go Gateway、Web UI 和工程流程的中文项目学习手册，使熟悉 TypeScript/React 的开发者能够理解主要功能的实现方案并独立定位源码。

**Architecture:** 文档采用一个总览索引和十六个主题章节。前三章建立环境、架构和端到端请求模型，中间章节按功能域追踪跨 TypeScript、Rust、Go 的调用链，最后三章覆盖工程能力、验证、排障和扩展。所有实现结论必须由入口代码、核心实现、下游依赖和对应测试交叉验证。

**Tech Stack:** Markdown、Mermaid、React 19、TypeScript、Tauri 2、Rust、Go、gRPC、WebSocket、SQLite、Node Test Runner、Cargo Test、Go Test。

---

## 文件结构

- Create: `docs/learning/README.md` — 总览、学习路线、章节索引、功能索引和命令速查。
- Create: `docs/learning/01-project-overview-and-setup.md` — 项目定位、依赖、安装、运行和调试准备。
- Create: `docs/learning/02-architecture-and-repository-map.md` — 运行单元、进程边界、目录职责和通信关系。
- Create: `docs/learning/03-agent-request-lifecycle.md` — 一次 Agent 请求的完整端到端链路。
- Create: `docs/learning/04-frontend-shell-and-chat-ui.md` — React 入口、应用外壳、聊天页面和消息渲染。
- Create: `docs/learning/05-chat-runtime-and-context.md` — Chat Runtime、回合队列、上下文组装、Hooks 和结束处理。
- Create: `docs/learning/06-model-providers-and-streaming.md` — Provider 适配、Thinking、流式事件、搜索和附件。
- Create: `docs/learning/07-tools-and-approval.md` — Builtin Tools、注册、执行、审批、安全和远程边界。
- Create: `docs/learning/08-skills-and-mcp.md` — Skills 与 MCP 的发现、安装、连接、加载和调用。
- Create: `docs/learning/09-memory-history-and-compaction.md` — Memory、History、Compaction、索引和持久化。
- Create: `docs/learning/10-subagents-hooks-and-automation.md` — Subagents、消息总线、Hooks、Todo、Cron 和调度。
- Create: `docs/learning/11-tauri-rust-backend.md` — Tauri command、runtime、service 和事件系统。
- Create: `docs/learning/12-gateway-and-webui.md` — Go Gateway、gRPC、WebSocket、会话管理和 Web UI。
- Create: `docs/learning/13-workspace-terminal-git-ssh.md` — 文件、编辑器、终端、进程、Git、SSH、SFTP 和隧道。
- Create: `docs/learning/14-settings-storage-i18n-platform.md` — 设置、敏感数据、同步、国际化和平台差异。
- Create: `docs/learning/15-testing-build-and-release.md` — 测试分层、构建、打包、协议生成和发布。
- Create: `docs/learning/16-troubleshooting-and-extension.md` — 综合排障、修改入口和精简练习。

## 通用写作契约

每章必须：

1. 以“本章目标”和“先读哪些文件”开头；
2. 对每项主要功能说明功能目标、入口、涉及层次、完整实现方案、数据流、设计亮点、异常与安全；
3. 用仓库相对路径和稳定符号名定位源码；
4. 对跨三个以上模块的关系提供 Mermaid 图；
5. 以简短“验证与扩展”结尾，只包含关键测试、修改入口和一个练习；
6. 明确区分桌面端、本地 Tauri 后端、远程 Gateway 和浏览器 Web UI；
7. 不把已有设计计划、测试桩或平台专用分支描述为所有环境都已生效的行为。

### Task 1: 建立总览索引与覆盖矩阵

**Files:**
- Create: `docs/learning/README.md`
- Reference: `Cargo.toml`
- Reference: `Makefile`
- Reference: `agent-gui/package.json`
- Reference: `agent-gui/src-tauri/Cargo.toml`
- Reference: `agent-gateway/go.mod`
- Reference: `agent-gateway/web/package.json`

- [ ] **Step 1: 写出手册导航骨架**

正文必须包含以下一级或二级标题：

```markdown
# Agent 项目完整学习手册
## 这套手册解决什么问题
## 项目的四个运行单元
## 推荐学习路线
## 章节索引
## 按功能查找
## 按技术栈查找
## 开发命令速查
## 阅读源码的方法
```

- [ ] **Step 2: 建立功能覆盖矩阵**

矩阵至少列出 Chat、Providers、Tools、Skills、MCP、Memory、History、Compaction、Subagents、Hooks、Cron、Workspace、Terminal、Git、SSH、SFTP、Tunnel、Settings、Gateway、Web UI、Build/Release，并为每项链接到唯一主章节。

- [ ] **Step 3: 写出三条学习路线**

分别提供“首次通读”“前端开发者”“后端与基础设施开发者”路线，并明确章节先后依赖，不使用笼统的“按需阅读”。

- [ ] **Step 4: 验证索引骨架**

Run:

```powershell
rg -n "^#|^##" docs/learning/README.md
```

Expected: 输出上述所有导航标题，且每个计划章节都出现一次。

### Task 2: 编写项目导读、环境与首次运行

**Files:**
- Create: `docs/learning/01-project-overview-and-setup.md`
- Reference: `agent-gui/README.md`
- Reference: `Makefile`
- Reference: `agent-gui/package.json`
- Reference: `agent-gateway/web/package.json`
- Reference: `agent-gateway/cmd/gateway/main.go`
- Reference: `agent-gui/src-tauri/tauri.conf.json`
- Reference: `Dockerfile`

- [ ] **Step 1: 解释项目定位与运行形态**

明确桌面应用、本地 Tauri 后端、远程 Gateway、浏览器 Web UI 的用途，解释“本地直接执行”和“通过 Gateway 远程执行”的区别。

- [ ] **Step 2: 写出可执行的环境准备说明**

列明 Node/pnpm、Rust/Cargo、Go、Tauri 系统依赖和可选的 protoc/Docker。Windows、macOS、Linux 的差异必须引用实际 Tauri 配置或 Makefile 目标。

- [ ] **Step 3: 写出四条最小运行路径**

正文必须逐条解释以下命令的工作目录、启动内容、端口或窗口，以及成功标志：

```powershell
pnpm --dir agent-gui install
pnpm --dir agent-gui tauri dev
go -C agent-gateway run ./cmd/gateway --token=dev-token --http-addr=:50052 --grpc-addr=:50051
pnpm --dir agent-gateway/web dev
```

- [ ] **Step 4: 增加首次调试观察点**

列出浏览器控制台、Rust 终端、Gateway 日志和本地数据目录四类观察点，并说明每类问题应先看哪里。

- [ ] **Step 5: 检查命令来源**

Run:

```powershell
rg -n '^(dev|build|dev-gateway|dev-webui|gateway-build|gateway-docker-run):' Makefile
```

Expected: 所有文档引用的 Makefile 目标都能在输出中找到。

### Task 3: 编写总体架构和仓库地图

**Files:**
- Create: `docs/learning/02-architecture-and-repository-map.md`
- Reference: `agent-gui/src/main.tsx`
- Reference: `agent-gui/src/App.tsx`
- Reference: `agent-gui/src-tauri/src/lib.rs`
- Reference: `agent-gateway/cmd/gateway/main.go`
- Reference: `agent-gateway/internal/server/grpc.go`
- Reference: `agent-gateway/internal/server/http.go`
- Reference: `agent-gateway/web/src/main.tsx`
- Reference: `agent-gateway/web/src/app/GatewayApp.tsx`

- [ ] **Step 1: 绘制四运行单元架构图**

Mermaid 图必须标出 React Desktop UI、Tauri/Rust、Go Gateway、Web UI，以及 Tauri invoke/event、gRPC、HTTP/WebSocket 三类通信通道。

- [ ] **Step 2: 解释三层后端结构**

用实际目录说明 `commands` 负责参数和 Tauri 暴露、`runtime` 负责操作系统资源、`services` 负责有状态业务流程；指出存在直接 command 实现时的例外。

- [ ] **Step 3: 编写目录责任表**

覆盖根目录、`agent-gui/src`、`agent-gui/src-tauri/src`、`agent-gateway/internal`、`agent-gateway/web/src`、`scripts/release` 和测试目录。

- [ ] **Step 4: 解释共享与复制代码的边界**

说明桌面 UI 与 Gateway Web UI 中相似组件/工具类型为何分别存在，以及后续修改时需要做双端一致性检查的区域。

- [ ] **Step 5: 验证入口路径**

Run:

```powershell
Test-Path agent-gui/src/main.tsx,agent-gui/src-tauri/src/lib.rs,agent-gateway/cmd/gateway/main.go,agent-gateway/web/src/main.tsx
```

Expected: 四项均为 `True`。

### Task 4: 编写一次 Agent 请求的完整生命周期

**Files:**
- Create: `docs/learning/03-agent-request-lifecycle.md`
- Reference: `agent-gui/src/pages/ChatPage.tsx`
- Reference: `agent-gui/src/lib/chat/runner/agentRunner.ts`
- Reference: `agent-gui/src/pages/chat/queue/chatTurnQueue.ts`
- Reference: `agent-gui/src/lib/chat/conversation/conversationState.ts`
- Reference: `agent-gui/src/lib/tools/builtinRegistry.ts`
- Reference: `agent-gui/src/lib/chat/history/chatHistory.ts`
- Reference: `agent-gui/src-tauri/src/commands/history/chat_history/commands.rs`
- Reference: `agent-gui/src-tauri/src/services/gateway/chat.rs`

- [ ] **Step 1: 确认真实入口符号和调用方向**

阅读上述文件并记录：提交用户消息、进入队列、创建模型请求、处理流事件、执行工具、更新 transcript、写历史记录的稳定符号名。若文件名与当前源码不符，先更新本计划中的引用再写正文。

- [ ] **Step 2: 绘制本地请求时序图**

时序图必须包含 User、Chat UI、Turn Queue、Agent Runner、Provider、Tool Registry、Tauri History 七个参与者，并表现纯文本回合与工具循环的分叉。

- [ ] **Step 3: 绘制远程请求时序图**

说明 Web UI 请求如何进入 Gateway、如何由已连接桌面端领取执行、结果如何流回浏览器，并指出 lease、heartbeat、queue 和 completion 的作用。

- [ ] **Step 4: 解释三类状态**

区分短期 UI state、一次回合的 runtime state、跨会话持久化 state，列出每类状态的所有者和生命周期。

- [ ] **Step 5: 对照测试验证关键阶段**

Run:

```powershell
rg -n "agentRunner|chatTurnQueue|conversationState|history" agent-gui/test/chat
```

Expected: 能定位队列、运行器、会话状态和历史持久化相关测试。

### Task 5: 编写前端应用外壳与聊天界面

**Files:**
- Create: `docs/learning/04-frontend-shell-and-chat-ui.md`
- Reference: `agent-gui/src/main.tsx`
- Reference: `agent-gui/src/App.tsx`
- Reference: `agent-gui/src/pages/ChatPage.tsx`
- Reference: `agent-gui/src/pages/chat/components/ChatComposerBar.tsx`
- Reference: `agent-gui/src/pages/chat/components/AssistantBubble.tsx`
- Reference: `agent-gui/src/components/Markdown.tsx`
- Reference: `agent-gui/src/pages/chat/transcript/rowModel.ts`
- Reference: `agent-gui/src/lib/transcript-virtual`
- Reference: `agent-gui/src/lib/sidebar`

- [ ] **Step 1: 解释 React 启动和 App 状态装配**

覆盖 StrictMode、设置加载、主题、国际化、应用更新、Memory Organizer、Cron Runner 和 Settings/Chat 页面切换。

- [ ] **Step 2: 解释聊天输入到 transcript 的 UI 数据流**

说明 Composer 如何构建用户内容、附件和 mention，ChatPage 如何协调运行时，AssistantBubble 如何按 round/tool/status 渲染。

- [ ] **Step 3: 解释虚拟列表和滚动跟随**

说明 row model、估算高度、live range、scroll-follow 状态机以及它们解决长对话性能问题的方式。

- [ ] **Step 4: 解释 Markdown 与附件安全策略**

说明图片来源策略、代码/数学/Mermaid 渲染、文件预览和不可信路径处理。

- [ ] **Step 5: 精简验证与扩展**

引用 `agent-gui/test/ui`、`agent-gui/test/chat` 中最相关的测试，练习仅要求追踪一次 Assistant tool trace 的渲染路径。

### Task 6: 编写 Chat Runtime、上下文与 Hooks

**Files:**
- Create: `docs/learning/05-chat-runtime-and-context.md`
- Reference: `agent-gui/src/lib/chat/runner/agentRunner.ts`
- Reference: `agent-gui/src/pages/chat/queue/chatTurnQueue.ts`
- Reference: `agent-gui/src/lib/chat/conversation/conversationState.ts`
- Reference: `agent-gui/src/lib/chat/conversation/run/hookLifecycle.ts`
- Reference: `agent-gui/src/lib/chat/conversation/run/gatewayBridgeEvents.ts`
- Reference: `agent-gui/src/pages/chat/gateway/useGatewayBridgeListeners.ts`
- Reference: `agent-gui/src/lib/memory/extraction`
- Reference: `agent-gui/src/lib/memory/prompts`

- [ ] **Step 1: 分解 Runtime 的输入、状态和输出**

列出模型上下文、settings、workdir、skills、memory、tools、attachments、gateway metadata 的来源和注入时机。

- [ ] **Step 2: 解释回合队列和取消语义**

说明排队、开始、取消、失败、完成和编辑重发如何改变会话状态，并指出重复执行和陈旧回调的防护。

- [ ] **Step 3: 解释 Hooks 生命周期**

说明请求前后脚本/HTTP Hook 的执行位置、取消 scope、错误处理和为什么 Hook 不应破坏主回合状态。

- [ ] **Step 4: 解释回合结束后的派生任务**

覆盖历史写入、标题、memory extraction、debug ledger、gateway completion 和使用量统计，标明同步关键路径与后台任务边界。

- [ ] **Step 5: 对照生命周期测试**

Run:

```powershell
node --test agent-gui/test/chat/agent-runner.test.mjs agent-gui/test/chat/chat-turn-queue.test.mjs agent-gui/test/chat/hook-lifecycle.test.mjs
```

Expected: 三个测试文件全部通过；若当前环境缺少已安装依赖，则记录为环境前置条件并运行静态源码核对。

### Task 7: 编写模型 Provider 与流式处理

**Files:**
- Create: `docs/learning/06-model-providers-and-streaming.md`
- Reference: `agent-gui/src/lib/providers/llm.ts`
- Reference: `agent-gui/src/lib/providers/runtime/types.ts`
- Reference: `agent-gui/src/lib/providers/runtime/thinkingLevels.ts`
- Reference: `agent-gui/src/lib/providers/runtime/textOnlyRuntime.ts`
- Reference: `agent-gui/src/lib/providers/runtime/textModeToolRecovery.ts`
- Reference: `agent-gui/src/lib/providers/deepSeekProviderAdapter.ts`
- Reference: `agent-gui/src/lib/providers/nativeWebSearch.ts`
- Reference: `agent-gui/src/lib/providers/nativeResponsesAttachments.ts`

- [ ] **Step 1: 建立 Provider 统一接口图**

说明 settings 中的 provider/model 如何转换为统一模型对象、请求选项和流事件，并列出厂商特例所在的适配层。

- [ ] **Step 2: 解释 Thinking 和文本模式**

说明 thinking level 映射、text-only runtime、工具恢复协议以及为什么不能把所有模型按同一种 tool-call 格式处理。

- [ ] **Step 3: 解释搜索、附件和重试**

覆盖 hosted/native search 事件、Responses 附件、流中断重试和 DeepSeek DSML tool payload。

- [ ] **Step 4: 建立事件到 UI 的映射表**

表格列出文本增量、thinking 增量、tool call、tool result、search status、usage、error 和 completion 的产生者、消费者与 UI 表现。

- [ ] **Step 5: 验证 Provider 测试**

Run:

```powershell
node --test agent-gui/test/providers/*.test.mjs
```

Expected: Provider 测试通过并覆盖 thinking、retry、search、attachments 和 DeepSeek 流解析。

### Task 8: 编写 Builtin Tools、审批与安全边界

**Files:**
- Create: `docs/learning/07-tools-and-approval.md`
- Reference: `agent-gui/src/lib/tools/builtinRegistry.ts`
- Reference: `agent-gui/src/lib/tools/builtinToolCatalog.ts`
- Reference: `agent-gui/src/lib/tools/builtinTypes.ts`
- Reference: `agent-gui/src/lib/tools/toolApprovalPolicy.ts`
- Reference: `agent-gui/src/lib/tools/fsTools.ts`
- Reference: `agent-gui/src/lib/tools/shellTools.ts`
- Reference: `agent-gui/src/lib/tools/mcpTools.ts`
- Reference: `agent-gui/src/lib/tools/skillTools.ts`
- Reference: `agent-gui/src/lib/tools/todoTools.ts`

- [ ] **Step 1: 解释工具组合中心**

说明 catalog、registry、bundle、schema、execute handler 和 execution mode 如何共同决定本轮可用工具。

- [ ] **Step 2: 绘制工具调用与审批流程**

流程图必须包含参数校验、风险判定、用户审批、执行、结果标准化、取消/超时和 transcript 回写。

- [ ] **Step 3: 按功能组解释工具实现方案**

分别覆盖文件、Shell/Terminal、MCP、Skills、Memory、Todo、Cron、SSH/Tunnel 和自定义系统工具；每组说明实际 backend 和远程可用性。

- [ ] **Step 4: 解释路径与命令安全**

覆盖 workdir 归一化、路径越界、符号链接或平台路径、删除/写入审批、shell timeout 和敏感工具选项。

- [ ] **Step 5: 验证工具测试**

Run:

```powershell
node --test agent-gui/test/tools/*.test.mjs
```

Expected: 注册、schema、审批、路径、Shell、MCP、Todo、SSH 和 Tunnel 测试通过。

### Task 9: 编写 Skills 与 MCP

**Files:**
- Create: `docs/learning/08-skills-and-mcp.md`
- Reference: `agent-gui/src/lib/skills/index.ts`
- Reference: `agent-gui/src/lib/skills/builtin.ts`
- Reference: `agent-gui/src/lib/tools/skillAccessPolicy.ts`
- Reference: `agent-gui/src-tauri/src/services/skills`
- Reference: `agent-gui/src-tauri/src/commands/integration/mcp.rs`
- Reference: `agent-gui/src/lib/tools/mcpManagerTools.ts`
- Reference: `agent-gui/src/lib/mcpRegistry/index.ts`

- [ ] **Step 1: 解释 Skill 生命周期**

按发现、元数据读取、校验、安装/创建、启用、提示词披露、资源访问和更新依次讲解，并区分 builtin、external、ClawHub 来源。

- [ ] **Step 2: 解释 Skills 写入可靠性**

说明路径规则、校验、后台 job、压缩包处理、临时目录/原子替换和访问策略解决的问题。

- [ ] **Step 3: 解释 MCP 生命周期**

按 settings 配置、server 启动、tool discovery、schema 转换、tool call、状态查询、停止/重启和错误恢复讲解。

- [ ] **Step 4: 绘制 Skills 与 MCP 对比图**

明确 Skill 是方法知识/资源包，MCP 是外部运行时能力，Builtin Tool 是应用内实现；列出三者进入模型上下文的不同路径。

- [ ] **Step 5: 验证测试**

Run:

```powershell
node --test agent-gui/test/skills/*.test.mjs agent-gui/test/tools/mcp-*.test.mjs
cargo test --manifest-path agent-gui/src-tauri/Cargo.toml services::skills
```

Expected: TypeScript 的显式 Skill/MCP 测试和 Rust Skills service 测试通过。

### Task 10: 编写 Memory、History 与 Compaction

**Files:**
- Create: `docs/learning/09-memory-history-and-compaction.md`
- Reference: `agent-gui/src/lib/memory`
- Reference: `agent-gui/src-tauri/src/services/memory`
- Reference: `agent-gui/src-tauri/src/commands/history/chat_history`
- Reference: `agent-gui/src/lib/chat/compaction/controller.ts`
- Reference: `agent-gui/src/lib/chat/compaction/policy.ts`
- Reference: `agent-gui/src/lib/chat/compaction/payload.ts`
- Reference: `agent-gui/src/lib/chat/compaction/fileLedger.ts`

- [ ] **Step 1: 绘制 Memory 数据模型**

说明 Markdown 内容、SQLite 索引、scope、type、review state、evidence、confidence、daily memory 和 organizer run 的关系。

- [ ] **Step 2: 解释提取、召回和写入链路**

从上下文 gating、prompt、plan tool、mutation 风险评估、标准化、证据记录、写文件和索引更新逐步讲解。

- [ ] **Step 3: 解释 History 数据模型**

覆盖 conversation、segment、message、active segment、FTS、share、rename/pin/delete 和 schema migration。

- [ ] **Step 4: 解释 Compaction 四阶段**

说明触发策略、token ledger、summary engine、checkpoint、payload 重建、file ledger 和压缩失败回退。

- [ ] **Step 5: 解释并发与一致性亮点**

说明写入串行化、SQLite 事务、文件事实源、索引可重建、提取去重和 organizer quota。

- [ ] **Step 6: 验证 Memory 与 Compaction 测试**

Run:

```powershell
node --test agent-gui/test/memory/*.test.mjs agent-gui/test/chat/compaction-*.test.mjs
cargo test --manifest-path agent-gui/src-tauri/Cargo.toml services::memory
```

Expected: Memory、History/Compaction 相关测试通过。

### Task 11: 编写 Subagents、Hooks 与自动化

**Files:**
- Create: `docs/learning/10-subagents-hooks-and-automation.md`
- Reference: `agent-gui/src/lib/subagents`
- Reference: `agent-gui/src-tauri/src/commands/history/subagent_store.rs`
- Reference: `agent-gui/src-tauri/src/commands/workspace/subagent_worktree.rs`
- Reference: `agent-gui/src/lib/automation`
- Reference: `agent-gui/src-tauri/src/services/automation`
- Reference: `agent-gui/src/components/cron/CronPromptRunner.tsx`
- Reference: `agent-gui/src/lib/tools/todoTools.ts`

- [ ] **Step 1: 解释 Subagent 调度模型**

覆盖 identity、run、roster、scheduler、policy、protocol、message bus、tool exposure、持久化和恢复。

- [ ] **Step 2: 解释 Worktree 隔离**

说明创建、状态、应用和清理流程，以及为什么文件系统共享与 Git 隔离必须分别处理。

- [ ] **Step 3: 解释 Hooks、Todo 与 Cron**

区分回合生命周期 Hook、模型维护的 Todo、持久化 Cron task 和 prompt run claim/complete 流程。

- [ ] **Step 4: 绘制自动化状态流**

状态图必须包含 validate、store、schedule、claim、run、complete/release、history 和 restart recovery。

- [ ] **Step 5: 验证相关测试**

Run:

```powershell
node --test agent-gui/test/subagents/*.test.mjs agent-gui/test/tools/todo-tools.test.mjs
cargo test --manifest-path agent-gui/src-tauri/Cargo.toml services::automation
```

Expected: Subagent、Todo 和 Rust 自动化测试通过。

### Task 12: 编写 Tauri/Rust 后端分层

**Files:**
- Create: `docs/learning/11-tauri-rust-backend.md`
- Reference: `agent-gui/src-tauri/src/main.rs`
- Reference: `agent-gui/src-tauri/src/lib.rs`
- Reference: `agent-gui/src-tauri/src/commands/mod.rs`
- Reference: `agent-gui/src-tauri/src/runtime/mod.rs`
- Reference: `agent-gui/src-tauri/src/services/mod.rs`
- Reference: `agent-gui/src-tauri/capabilities/default.json`
- Reference: `agent-gui/src-tauri/tauri.conf.json`

- [ ] **Step 1: 解释 Tauri 启动过程**

覆盖 binary 到 library、Builder setup、state 注册、invoke handler、事件监听、托盘、窗口关闭和平台分支。

- [ ] **Step 2: 解释 command 参数和错误边界**

使用文件、终端、Memory、Gateway 各选一个 command，展示前端 invoke 名称、serde 参数、返回类型和错误字符串如何对应。

- [ ] **Step 3: 解释 runtime 资源管理**

覆盖 process、shell runner、task runner、managed process journal、PTY terminal、SSH channel 和 SFTP session 的所有权及清理。

- [ ] **Step 4: 解释 service 的长生命周期状态**

覆盖 Gateway controller、Skills manager、Memory store、Automation scheduler、Tunnel store 和 Workspace watcher。

- [ ] **Step 5: 解释 capability 与安全面**

说明 Tauri capability、开放 command、文件/网络访问和平台 manifest 之间的关系。

- [ ] **Step 6: 验证 Rust 工程**

Run:

```powershell
cargo check --manifest-path agent-gui/src-tauri/Cargo.toml --tests
```

Expected: Rust crate 和测试目标检查成功。

### Task 13: 编写 Go Gateway 与 Web UI

**Files:**
- Create: `docs/learning/12-gateway-and-webui.md`
- Reference: `agent-gateway/cmd/gateway/main.go`
- Reference: `agent-gateway/internal/config/config.go`
- Reference: `agent-gateway/internal/auth`
- Reference: `agent-gateway/internal/server`
- Reference: `agent-gateway/internal/session`
- Reference: `agent-gateway/proto/v1/gateway.proto`
- Reference: `agent-gateway/web/src/app/GatewayApp.tsx`
- Reference: `agent-gateway/web/src/lib/gatewaySocket.ts`
- Reference: `agent-gateway/web/src/lib/chat/stream`

- [ ] **Step 1: 绘制 Gateway 双协议架构**

标出桌面端与 Gateway 的 gRPC 长连接、浏览器与 Gateway 的 HTTP/WebSocket、静态 Web UI 嵌入和认证中间件。

- [ ] **Step 2: 解释 Session Manager**

覆盖 agent registry、command queue、conversation ingress/stream、settings/history sync、terminal/SFTP、workspace activity 和 tunnel state。

- [ ] **Step 3: 解释 Chat 远程执行方案**

说明 enqueue、claim、lease、heartbeat、local started、stream reconcile、complete/fail/cancel 和过载保护。

- [ ] **Step 4: 解释 WebSocket 路由与 payload**

按 chat、history、settings、workspace、terminal、SFTP、Git、skills、memory、cron、tunnel 分类说明 handler 到 session manager 的路径。

- [ ] **Step 5: 解释 Web UI 客户端**

覆盖登录 token、GatewaySocket、conversation stream、transcript reducer、settings sync、项目工具 backend 和 Tauri shim。

- [ ] **Step 6: 验证 Gateway 与 Web UI**

Run:

```powershell
go -C agent-gateway test ./...
pnpm --dir agent-gateway/web test
pnpm --dir agent-gateway/web build
```

Expected: Go 测试、Web UI 测试和 TypeScript/Vite 构建全部成功。

### Task 14: 编写工作区、终端、Git、SSH、SFTP 与隧道

**Files:**
- Create: `docs/learning/13-workspace-terminal-git-ssh.md`
- Reference: `agent-gui/src/components/project-tools`
- Reference: `agent-gui/src/components/workspace-editor`
- Reference: `agent-gui/src/lib/terminal`
- Reference: `agent-gui/src/lib/git`
- Reference: `agent-gui/src/lib/sftp`
- Reference: `agent-gui/src/lib/managed-process`
- Reference: `agent-gui/src-tauri/src/commands/workspace`
- Reference: `agent-gui/src-tauri/src/runtime/terminal`
- Reference: `agent-gui/src-tauri/src/services/tunnel`

- [ ] **Step 1: 解释工作区工具框架**

说明 Right Dock registry、session/tab model、file tree invalidation、编辑器/预览 overlay 和本地/远程 backend 替换。

- [ ] **Step 2: 解释文件和 Git 功能**

覆盖列表、读取、编辑、重命名、删除、watch event，以及 Git status/diff/log/branch/stage/commit/push 的调用链和破坏性操作确认。

- [ ] **Step 3: 解释本地终端和后台进程**

覆盖 PTY 创建、attach、input、resize、tail、close、session store，以及 managed process journal 和重启恢复。

- [ ] **Step 4: 解释 SSH 与 SFTP**

覆盖认证方式、host key、交互提示、latency、remote exec、terminal tabs、SFTP CRUD/transfer/cancel/status。

- [ ] **Step 5: 解释 Tunnel**

说明本地代理、Gateway tunnel state、create/update/check/close、URL rewrite 和安全限制。

- [ ] **Step 6: 验证项目工具测试**

Run:

```powershell
node --test agent-gui/test/settings/right-dock-model.test.mjs agent-gui/test/tools/ssh-manager-tools.test.mjs agent-gui/test/tools/tunnel-manager-tools.test.mjs agent-gui/test/tools/shell-tools.test.mjs agent-gui/test/tools/git-graph.test.mjs
```

Expected: 工作区模型、SSH、Tunnel、Shell 和 Git 图测试通过。

### Task 15: 编写设置、存储、国际化和平台差异

**Files:**
- Create: `docs/learning/14-settings-storage-i18n-platform.md`
- Reference: `agent-gui/src/App.tsx`
- Reference: `agent-gui/src/lib/settings`
- Reference: `agent-gui/src/pages/settings`
- Reference: `agent-gui/src-tauri/src/commands/config/settings`
- Reference: `agent-gui/src/i18n`
- Reference: `agent-gui/src/lib/runtimePlatform.ts`
- Reference: `agent-gui/src-tauri/src/runtime/platform.rs`
- Reference: `agent-gui/src-tauri/tauri.windows.conf.json`
- Reference: `agent-gui/src-tauri/tauri.macos.conf.json`
- Reference: `agent-gui/src-tauri/tauri.linux.release.conf.json`

- [ ] **Step 1: 解释设置模型与加载流程**

覆盖 default、normalize、runtime default、hydrate、React ref、串行保存链和 save state。

- [ ] **Step 2: 解释敏感字段持久化**

说明 Provider API key、SSH password/private key 的 patch/update 语义，为什么同步 payload 与完整本地设置不同。

- [ ] **Step 3: 解释 Gateway settings sync**

覆盖 payload 构建、变更检测、发布、远端应用、冲突边界和断线重连后的同步。

- [ ] **Step 4: 解释国际化和主题**

说明 LocaleContext、翻译配置、主题解析、系统主题订阅和 Web/Desktop 一致性要求。

- [ ] **Step 5: 解释平台差异**

覆盖窗口标题栏、托盘行为、Traffic Lights、manifest/config 合并、shell/路径和打包格式。

- [ ] **Step 6: 验证设置与国际化测试**

Run:

```powershell
node --test agent-gui/test/settings/*.test.mjs agent-gui/test/i18n/*.test.mjs agent-gui/test/runtime-platform.test.mjs
```

Expected: 设置标准化、同步、SSH、远程输入、国际化和平台测试通过。

### Task 16: 编写测试、构建和发布流程

**Files:**
- Create: `docs/learning/15-testing-build-and-release.md`
- Reference: `agent-gui/test/README.md`
- Reference: `agent-gateway/test/README.md`
- Reference: `agent-gui/package.json`
- Reference: `agent-gateway/web/package.json`
- Reference: `Makefile`
- Reference: `Dockerfile`
- Reference: `scripts/release`
- Reference: `agent-gui/src-tauri/tauri.windows.conf.json`
- Reference: `agent-gui/src-tauri/tauri.macos.conf.json`
- Reference: `agent-gui/src-tauri/tauri.linux.release.conf.json`

- [ ] **Step 1: 建立测试分层表**

说明 Node 源码级测试、React/UI 逻辑测试、Rust unit/integration、Go package/e2e、Web UI 测试分别验证什么及其限制。

- [ ] **Step 2: 解释无传统前端测试框架的测试机制**

说明 `.mjs` 测试如何加载 TypeScript 模块、哪些测试检查源码结构、哪些执行真实逻辑，避免把所有 Node Test Runner 测试称为端到端测试。

- [ ] **Step 3: 解释构建产物链**

覆盖 Vite bundle、Tauri crate、proto generation、Web UI embed、Go static binary、Docker image 和平台安装包。

- [ ] **Step 4: 解释版本与发布**

覆盖 Git tag、版本注入、updater manifest、AI release notes、GitHub secrets bootstrap、签名和 macOS notarization。

- [ ] **Step 5: 写出风险分级验证矩阵**

分别给出仅改 UI、改 Chat Runtime、改 Rust command、改 Gateway protocol、改发布脚本时的最小验证命令。

- [ ] **Step 6: 验证工程命令**

Run:

```powershell
pnpm --dir agent-gui test
pnpm --dir agent-gui build
cargo check --manifest-path agent-gui/src-tauri/Cargo.toml --tests
go -C agent-gateway test ./...
pnpm --dir agent-gateway/web test
pnpm --dir agent-gateway/web build
```

Expected: 所有可在当前平台执行的检查成功；平台签名、公证和 Docker smoke test 只说明前置条件，不在普通文档验证中触发。

### Task 17: 编写排障、扩展指南并完成全书校验

**Files:**
- Create: `docs/learning/16-troubleshooting-and-extension.md`
- Modify: `docs/learning/README.md`
- Verify: `docs/learning/*.md`

- [ ] **Step 1: 编写按症状排障树**

至少覆盖：应用无法启动、模型无响应、流式输出中断、工具不出现、审批卡住、MCP/Skill 加载失败、Memory 不写入、History/Compaction 异常、Gateway 离线、终端/SSH/SFTP 失败、设置不同步和构建失败。

- [ ] **Step 2: 编写功能扩展决策表**

用“想增加什么能力 → 应从哪个 registry/page/command/service/protocol/test 开始”的方式给出入口。每项只保留最重要的修改点，不写冗长教程。

- [ ] **Step 3: 为每章补一个简短练习**

练习必须能通过阅读或小范围改动完成，例如追踪事件、增加日志、添加只读工具字段或补充一个测试；不得要求实现未在文档中解释的大型功能。

- [ ] **Step 4: 完成索引和交叉链接**

更新 `docs/learning/README.md`，保证十六个章节全部有序链接；每章至少链接到前置章节、相关章节和下一章。

- [ ] **Step 5: 扫描占位符和格式问题**

Run:

```powershell
rg -n "TBD|TODO|待补充|后续补充|这里填写|适当处理|类似上文" docs/learning
git diff --check
```

Expected: 占位符扫描无输出，`git diff --check` 无错误。

- [ ] **Step 6: 验证 Markdown 相对链接目标**

Run:

```powershell
@'
$root = (Resolve-Path '.').Path
$errors = @()
Get-ChildItem 'docs/learning' -Filter '*.md' | ForEach-Object {
  $file = $_
  $text = Get-Content -Raw -Encoding utf8 $file.FullName
  [regex]::Matches($text, '\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)') | ForEach-Object {
    $target = $_.Groups[1].Value
    if ($target -match '^(https?:|mailto:)') { return }
    $resolved = Join-Path $file.DirectoryName $target
    if (-not (Test-Path $resolved)) { $errors += "$($file.Name) -> $target" }
  }
}
if ($errors.Count) { $errors; exit 1 }
'@ | powershell -NoProfile -Command -
```

Expected: 无输出且退出码为 0。

- [ ] **Step 7: 检查章节和 Mermaid 覆盖**

Run:

```powershell
(Get-ChildItem docs/learning -Filter '*.md').Count
rg -l '^```mermaid' docs/learning
```

Expected: Markdown 文件数为 17；架构、生命周期、Tools、Memory、Automation、Gateway 等复杂章节均出现在 Mermaid 文件列表中。

- [ ] **Step 8: 运行最终工程验证**

Run:

```powershell
pnpm --dir agent-gui test
pnpm --dir agent-gui build
cargo check --manifest-path agent-gui/src-tauri/Cargo.toml --tests
go -C agent-gateway test ./...
pnpm --dir agent-gateway/web test
pnpm --dir agent-gateway/web build
```

Expected: 所有命令成功。若某命令因外部环境缺失失败，记录准确错误、已完成的替代验证和未验证范围，不能声称全部通过。

- [ ] **Step 9: 提交完整学习手册**

```powershell
git add -f docs/learning
git commit -m "docs: add complete Agent project learning handbook"
```

Expected: 提交仅包含 `docs/learning/` 下的学习手册文件。

## 计划自检

执行前确认：

- 设计说明中的二十一个主题全部映射到上述十六章；
- 所有计划创建文件都有唯一职责；
- 桌面前端、Rust 后端、Go Gateway、Web UI 和工程脚本均有独立章节；
- “验证与扩展”保持简洁，没有把手册主体变成练习册；
- 计划没有要求修改业务代码；
- 所有路径和命令均基于当前仓库，而不是旧文档中的假设。
