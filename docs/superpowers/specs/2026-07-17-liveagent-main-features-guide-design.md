# LiveAgent 主要功能与源码学习指南设计说明

## 1. 文档目标

生成一份面向首次接触 LiveAgent 的开发者的中文教学文档，使读者完成学习后能够：

1. 理解 LiveAgent 的整体架构和主要进程边界。
2. 解释一条用户消息从提交到完成的完整生命周期。
3. 理解 Chat Runtime、Tools、Skills、MCP、Memory、History Compaction 之间的关系。
4. 根据功能现象定位主要 TypeScript、Rust 和 Go 源码入口。
5. 完成常见功能修改前的影响面分析，并能按顺序排查典型故障。

目标文档保存为 `docs/tutorials/liveagent-main-features-guide.md`。

## 2. 目标读者与前置知识

目标读者是刚接触本项目的开发者。文档不假设读者熟悉 Agent 运行时、MCP、上下文压缩或长期记忆系统，但默认读者具备基础编程能力，能够阅读 TypeScript、Rust 和 Go 的文件结构及简单代码。

文档先解释概念与边界，再引导读者进入源码，避免一开始用大量实现细节增加理解负担。

## 3. 教学组织方式

采用“完整请求生命周期 + 功能模块深入 + 开发实践”的混合式结构。

### 3.1 第一层：全局认知

介绍 LiveAgent 的产品定位，以及以下运行单元的职责和权限边界：

- 桌面 GUI：用户交互、Chat Runtime 和本地工具编排。
- Tauri/Rust：本地系统能力、SQLite 持久化、MemoryStore、MCP runtime 等高权限能力。
- Go Gateway：远程认证、连接、协议转发和有界事件缓冲。
- Browser WebUI：远程操作界面，不直接获得用户本地文件或工具执行权限。

核心结论是：桌面端是执行与数据真相源，Gateway 是中继，WebUI 是远程操作面。

### 3.2 第二层：完整请求生命周期

使用统一案例贯穿全文：用户要求 Agent 读取文件、修改代码，并记住一条项目约定。

按以下过程解释一次请求：

1. Chat UI 收集输入、附件、模型、执行模式和工作目录。
2. Runtime 加载系统提示、Skills、Memory Overview、历史 active segment 和 hooks。
3. Context Builder 组装消息、工具、附件与压缩摘要。
4. 模型开始流式响应；tools 模式进入模型与工具之间的循环。
5. 工具调用经 Builtin Registry 分派到文件、Shell、Memory、MCP 等 executor。
6. token、thinking、tool status 和结果同步到 transcript 与 Gateway event。
7. 回合结束后保存 History Segment、生成标题、执行 hooks，并触发静默 Memory 提取。
8. 当上下文超出预算时，生成 Summary Checkpoint，后续请求携带摘要和未覆盖的尾部消息。

### 3.3 第三层：功能模块深入

分别讲解以下模块：

1. Chat Runtime 与 `text`、`tools`、`agent-dev` 三种执行模式。
2. Builtin Tools、工具注册表、工具循环、权限和 UI trace。
3. Skills 的发现、选择、Prompt 注入、安装和运行时根目录。
4. MCP Server 配置、动态工具加载、调用和 runtime 生命周期。
5. Memory 的存储、召回、静默提取、Evidence、Quota 和 Organizer。
6. History V3 Segment、FTS、编辑重发、分享与 Context Compaction。

每章统一包含：解决的问题、核心概念、运行流程、关键数据结构、源码入口、常见修改点和排障入口。

### 3.4 第四层：开发实践

通过逐步练习把概念连接到实际代码：

1. 启动并辨认 GUI、Tauri、Gateway 和 WebUI。
2. 追踪一次纯文本对话。
3. 追踪一次 `Read` 或 `Grep` 工具调用。
4. 观察一条 Memory 的提取、持久化和下一轮注入。
5. 构造长对话，观察 Summary Checkpoint 与 File Ledger。
6. 设计一个简单 Builtin Tool 的改动清单，包括 schema、executor、metadata、UI trace 和测试。

## 4. 关键概念辨析

文档必须明确解释以下区别：

| 概念 | 主要职责 | 不负责什么 |
|---|---|---|
| History | 保存对话实际发生的消息、工具调用与分段摘要 | 不主动判断哪些事实值得跨会话记忆 |
| Memory | 保存未来对话仍有价值的用户偏好、反馈和项目知识 | 不替代完整对话记录 |
| Skills | 向模型提供工作方法、领域知识和操作流程 | 本身不等于可执行系统能力 |
| Tools | 向模型提供可调用的结构化操作 | 不负责长期教学提示的组织 |
| MCP | 以协议方式接入外部工具服务 | 不等于 LiveAgent 自带的 Builtin Tools |
| Compaction | 改变后续模型请求携带历史的方式 | 不删除持久化的完整历史记录 |
| Gateway | 转发远程命令和事件 | 不直接执行本地业务工具 |

## 5. 源码阅读路线

每个模块采用三级阅读路线：

1. 入口层：用户动作或对话请求从哪里进入。
2. 主干层：数据如何在 TypeScript Runtime 中构造、转换和分派。
3. 落地层：Rust 持久化、系统能力、MCP runtime 或 Gateway 协议如何执行。

重点源码路线包括：

```text
ChatPage / ChatComposerBar
  -> runTextConversationTurn / runAgentConversationTurn
  -> conversationContextBuilders / conversationState
  -> llm / agentRunner
  -> builtinRegistry
  -> fsTools / shellTools / memoryTools / mcpTools
  -> Tauri commands / Rust services
  -> chat history / memory extraction / gateway events
```

路径以当前仓库实际结构为准，文档编写时需要核对已移动或重构的文件，避免机械复制旧索引中的过时路径。

## 6. 可视化与示例策略

文档使用必要且紧凑的可视化：

- 一张总体进程边界图。
- 一张完整消息生命周期流程图。
- 一张工具循环图。
- 一张 Memory 写入与召回图。
- 一张 History Segment 与 Compaction 图。

使用 Mermaid 绘制流程关系，使用表格对比概念和源码入口，使用少量简化伪代码解释控制流。源码片段只保留帮助理解的部分，避免复制大段实现。

## 7. 排障章节设计

排障内容采用“现象 → 检查顺序 → 关键源码 → 常见原因”的固定格式，覆盖：

- 模型能够回答但没有调用工具。
- 工具已经执行但 UI 没有显示 trace。
- Memory 没有写入、被门控跳过或无法召回。
- MCP Server 已配置但动态工具没有出现。
- 长对话压缩后遗漏早期关键信息。
- GUI 正常但 WebUI 行为异常。
- 新增历史字段后旧数据库初始化或迁移失败。

排障建议必须体现项目边界，例如 WebUI 工具异常应继续检查 Gateway 转发和桌面执行端，而不是假设浏览器直接执行工具。

## 8. 准确性与验证

教学文档以用户指定的五份功能文档为主要输入，并用当前源码目录、总体架构文档、源码索引和开发说明交叉核对。

完成后执行以下检查：

1. 检查所有引用的本地文件是否存在。
2. 检查 Mermaid 代码块结构和 Markdown 格式。
3. 检查核心术语在不同章节中的含义是否一致。
4. 检查是否明确区分 GUI、Tauri、Gateway 和 WebUI 的权限边界。
5. 检查练习是否从只读观察逐步过渡到功能设计，避免要求新手直接修改高风险持久化逻辑。
6. 运行 `git diff --check`，确认文档无空白格式问题。

## 9. 范围边界

本次文档重点覆盖 Chat Runtime、Tools、Skills/MCP、Memory、History Compaction，以及理解这些功能所需的总体架构。

Gateway 内部协议、部署发布、Cron、Hooks、Subagent 和完整 UI 设计不会作为独立深度章节；它们只在主流程或工具边界中按需介绍，并链接到已有架构文档。这样可以保持教程聚焦，同时为后续深入学习提供入口。
