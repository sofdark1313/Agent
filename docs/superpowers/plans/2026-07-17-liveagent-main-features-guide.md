# LiveAgent Main Features Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建一份面向项目新手、能够支持功能修改与故障排查的 LiveAgent 中文教学文档。

**Architecture:** 教程使用“一次 Agent 请求的完整生命周期”建立全局模型，再按 Chat Runtime、Tools、Skills/MCP、Memory、History Compaction 深入。所有模块共用“读取文件、修改代码、记住项目约定”的示例，并将概念、数据流、源码入口、修改影响面和排障方法放在同一条学习路径中。

**Tech Stack:** Markdown、Mermaid、React/TypeScript、Tauri/Rust、Go Gateway、SQLite

---

## 文件结构

- Create: `docs/tutorials/liveagent-main-features-guide.md` — 正式教学文档，包含架构、请求生命周期、五个功能域、源码路线、实践和排障。
- Reference: `docs/features/chat-runtime.md` — Chat Runtime 与执行模式事实来源。
- Reference: `docs/features/tools.md` — Builtin Tools、MCP Tools、MemoryManager、Subagent 边界事实来源。
- Reference: `docs/features/skills-and-mcp.md` — Skills 与 MCP 生命周期事实来源。
- Reference: `docs/features/memory.md` — Memory 存储、召回、提取、组织和配额事实来源。
- Reference: `docs/features/history-compaction.md` — History V3 Segment、FTS、分享和 Compaction 事实来源。
- Reference: `docs/architecture/overview.md` — GUI、Tauri、Gateway、WebUI 进程边界事实来源。
- Reference: `docs/reference/source-map.md` — 初始源码入口索引，写作时必须用当前文件树复核。

### Task 1: 建立教程骨架和学习地图

**Files:**
- Create: `docs/tutorials/liveagent-main-features-guide.md`

- [ ] **Step 1: 创建标题、适用读者和学习目标**

写入以下明确目标：理解四个运行单元边界、追踪完整请求、区分五个功能域、定位源码、完成影响面分析和排障。

- [ ] **Step 2: 写入推荐学习顺序和统一案例**

统一案例固定为：“用户要求 Agent 读取一个项目文件、修改代码，并记住一条项目约定。”说明后续各章从不同模块观察同一请求。

- [ ] **Step 3: 写入术语速查表**

表格必须包含 GUI、Tauri、Gateway、WebUI、Turn、Tool Loop、Skill、MCP、Memory、History Segment、Checkpoint、FTS。

- [ ] **Step 4: 检查骨架完整性**

Run:

```powershell
rg -n '^#|^##|^###' docs/tutorials/liveagent-main-features-guide.md
```

Expected: 输出包含导读、总体架构、请求生命周期、五个功能域、协作关系、源码路线、实践、排障和总结章节。

- [ ] **Step 5: 提交骨架**

```powershell
git add -f docs/tutorials/liveagent-main-features-guide.md
git commit -m "docs: scaffold LiveAgent main features guide"
```

### Task 2: 编写总体架构与完整请求生命周期

**Files:**
- Modify: `docs/tutorials/liveagent-main-features-guide.md`

- [ ] **Step 1: 写总体架构章节**

用表格解释桌面 GUI、Tauri/Rust、Go Gateway、Browser WebUI 的职责、通信对象和权限边界。明确“桌面端是真相源、Gateway 不执行本地业务工具、WebUI 没有直接本地权限”。

- [ ] **Step 2: 添加总体进程 Mermaid 图**

图中数据方向必须是 WebUI → Gateway → Desktop Runtime/Tauri，并展示 Desktop Runtime 连接模型 API、Builtin Tools、MCP Server、SQLite/Markdown 存储。

- [ ] **Step 3: 解释三种 Execution Mode**

对比 `text`、`tools`、`agent-dev` 的入口、工具可用性、可观测性和典型用途。

- [ ] **Step 4: 写一次请求的十二步生命周期**

从 Composer 收集输入开始，依次覆盖 Skills/Memory/History 加载、上下文构造、预算检查、模型流式调用、工具循环、Transcript/Gateway event、历史保存、标题、hooks、Memory 提取。

- [ ] **Step 5: 添加 Tool Loop Mermaid 图和简化伪代码**

伪代码只表达控制流：构造 request → 调用模型 → 收集 tool calls → 执行 → 把 tool results 追加回上下文 → 继续，直到没有工具调用或发生取消/错误。

- [ ] **Step 6: 提交架构章节**

```powershell
git add docs/tutorials/liveagent-main-features-guide.md
git commit -m "docs: explain LiveAgent request lifecycle"
```

### Task 3: 编写 Chat Runtime 与工具系统章节

**Files:**
- Modify: `docs/tutorials/liveagent-main-features-guide.md`

- [ ] **Step 1: 写 Chat Runtime 的上下文构造**

解释 system prompt、active segment messages、tools、attachments、hosted search 和 summary checkpoint 的来源与清洗过程。

- [ ] **Step 2: 写流式状态与回合结束处理**

解释 token、thinking、tool status 如何进入 transcript，Hooks 生命周期如何围绕 agent/turn/message/tool execution 工作，以及完成后如何持久化和提取 Memory。

- [ ] **Step 3: 写 Builtin Registry 的四个输出**

解释 `tools`、`executeToolCall`、`metadataByName`、`hasTool`，并用调用链连接 `runAgentConversationTurn.ts`、`builtinRegistry.ts`、具体 executor 和 Tauri/Rust。

- [ ] **Step 4: 解释工具类别和执行边界**

覆盖 FS、Shell、SkillsManager、McpManager、Dynamic MCP、MemoryManager、TodoWrite、Subagent，并明确 GUI 本地执行、WebUI 间接执行、Gateway 不执行。

- [ ] **Step 5: 写新增 Builtin Tool 的影响面清单**

清单包含 schema、executor、metadata、UI trace details、Tauri command、错误边界、runtime scope、agent-dev 可观测性和测试。

- [ ] **Step 6: 提交 Chat 与 Tools 章节**

```powershell
git add docs/tutorials/liveagent-main-features-guide.md
git commit -m "docs: teach Chat runtime and tool system"
```

### Task 4: 编写 Skills、MCP 与 Memory 章节

**Files:**
- Modify: `docs/tutorials/liveagent-main-features-guide.md`

- [ ] **Step 1: 写 Skills 生命周期**

解释 runtime root、builtin seed、discover、selected/always-on、Prompt 注入、SkillsManager 管理，以及写侧 guard 和 stage-then-swap 的一致性意义。

- [ ] **Step 2: 写 MCP 生命周期**

解释 server 配置、enabled/selected、`mcp_list_tools`、动态命名、`mcp_call_tool`、McpManager、runtime pool 和配置唯一写路径。

- [ ] **Step 3: 添加 Skills、Tools、MCP 对比表**

按“提供什么、何时加载、是否执行代码、典型例子、主要源码”五个维度对比。

- [ ] **Step 4: 写 Memory 总体模型和存储结构**

明确 Markdown 是事实源、SQLite 是索引，解释 global/project、user/feedback/project/reference/daily、reviewed/unreviewed 和 Evidence 置信度契约。

- [ ] **Step 5: 添加 Memory 召回与写入 Mermaid 图**

召回路径包含 overview 注入和 MemoryManager 主动查询；写入路径包含回合后 extraction gate、SubmitMemoryPlan、plan validation、`memory_apply_batch`、Rust canonical frontmatter。

- [ ] **Step 6: 解释 Organizer 与 Quota**

讲清 scan → cluster → plan → gate → apply，以及 normal 到 exhausted 的配额阶梯不会静默归档用户记忆。

- [ ] **Step 7: 提交 Skills/MCP/Memory 章节**

```powershell
git add docs/tutorials/liveagent-main-features-guide.md
git commit -m "docs: teach Skills MCP and Memory"
```

### Task 5: 编写 History、Compaction 和系统协作章节

**Files:**
- Modify: `docs/tutorials/liveagent-main-features-guide.md`

- [ ] **Step 1: 写 History V3 Segment 模型**

解释 conversation header、active segment、summary checkpoint、append segment、truncate、FTS 和分享数据。

- [ ] **Step 2: 写 Compaction 生命周期**

覆盖 pre-send、mid-stream、post-tool 三个触发点，以及预算估算、summary request、checkpoint 应用、resume context 四个阶段。

- [ ] **Step 3: 添加 Segment/Checkpoint Mermaid 图**

图中必须表达旧 Segment 仍持久化保留，后续请求使用 Summary + 未覆盖 Tail Messages，而不是删除旧历史。

- [ ] **Step 4: 解释 File Ledger 的确定性下界**

解释只扫描成功 FS toolCall、modified 粘性、跨 checkpoint 继承、安全清洗、上限和路径别名限制。

- [ ] **Step 5: 写五个系统的协作矩阵**

用统一案例分别说明 Chat Runtime、Tools、Skills/MCP、Memory、History/Compaction 在请求前、请求中、请求后的职责。

- [ ] **Step 6: 提交 History 与协作章节**

```powershell
git add docs/tutorials/liveagent-main-features-guide.md
git commit -m "docs: teach history and context compaction"
```

### Task 6: 编写源码路线、实践和排障

**Files:**
- Modify: `docs/tutorials/liveagent-main-features-guide.md`

- [ ] **Step 1: 写三级源码阅读路线**

按入口层、TypeScript 主干层、Rust/Go 落地层列出 Chat、Tools、Skills/MCP、Memory、History 的具体文件。

- [ ] **Step 2: 写六个动手练习**

每个练习包含目标、观察点、操作步骤、成功判据和延伸问题。前五个练习只读或低风险观察，第六个练习只要求设计新增工具的改动清单，不直接修改生产代码。

- [ ] **Step 3: 写七类故障排查表**

覆盖无工具调用、UI 无 trace、Memory 不写入/不召回、MCP 工具未出现、压缩遗漏信息、GUI/WebUI 不一致、历史 schema 迁移失败。

- [ ] **Step 4: 写功能修改检查表和后续阅读链接**

按修改 Chat、Tool、Memory、MCP、History、GUI/WebUI mirror 列出必查范围，并链接到 `docs/architecture/*`、`docs/features/*`、`docs/operations/development.md`。

- [ ] **Step 5: 提交实践与排障章节**

```powershell
git add docs/tutorials/liveagent-main-features-guide.md
git commit -m "docs: add LiveAgent exercises and troubleshooting"
```

### Task 7: 验证教程准确性与格式

**Files:**
- Verify: `docs/tutorials/liveagent-main-features-guide.md`

- [ ] **Step 1: 检查占位符和模糊表达**

Run:

```powershell
rg -n 'TBD|TODO|待补充|以后再写|PLACEHOLDER|适当处理|类似上文' docs/tutorials/liveagent-main-features-guide.md
```

Expected: 无输出。

- [ ] **Step 2: 提取反引号中的源码路径并检查存在性**

人工核对所有作为源码入口出现的路径；对函数名、表名、配置字段等非路径标识不做文件存在性判断。发现过时路径时以 `rg --files` 的当前结果修正文档。

- [ ] **Step 3: 检查核心边界表述**

Run:

```powershell
rg -n '真相源|Gateway.*不.*执行|WebUI.*不.*直接|Compaction.*不.*删除|Markdown.*事实源|SQLite.*索引' docs/tutorials/liveagent-main-features-guide.md
```

Expected: 六项核心结论都能在正文中定位。

- [ ] **Step 4: 检查 Markdown 空白和仓库状态**

Run:

```powershell
git diff --check -- docs/tutorials/liveagent-main-features-guide.md
git status --short
```

Expected: `git diff --check` 无输出；状态中不出现未提交的教程改动。

- [ ] **Step 5: 完成最终内容审阅**

逐章确认统一案例、术语和源码路径一致；确认每个模块都有概念、流程、源码、修改点和排障内容；确认全文没有把 Gateway 或 WebUI描述为本地工具执行者。

