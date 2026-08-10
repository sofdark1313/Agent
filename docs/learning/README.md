# Agent 项目完整学习手册

这套手册面向已经熟悉 TypeScript 与 React 的开发者。目标不是把源码逐行翻译一遍，而是帮助你建立能够指导调试和开发的心智模型：用户操作从哪里进入、状态由谁持有、请求怎样跨越 React、Tauri/Rust、Go Gateway 和浏览器、数据在哪里持久化，以及修改某项功能时应当从哪个入口开始。

## 这套手册解决什么问题

完整读完后，你应该能够：

- 在本地启动桌面端、Gateway 和 Gateway Web UI；
- 说清桌面 React、Tauri/Rust、Go Gateway、Web UI 四个运行单元的职责；
- 从 `ChatPage.send()` 追踪一次本地或远程 Agent 请求；
- 理解 Chat Runtime、Provider、Tools、Skills、MCP、Memory、History 和 Compaction 如何协作；
- 定位 Subagent、Cron、Hooks、工作区、终端、Git、SSH、SFTP、Tunnel 等功能的实现入口；
- 根据改动风险选择正确的测试、构建和发布验证方式。

仓库中原有的 [LiveAgent 主要功能与源码学习指南](../tutorials/liveagent-main-features-guide.md) 仍然有参考价值。本手册在此基础上扩大范围，覆盖整个仓库，并把各项功能的实现方案、跨层调用链和设计取舍讲得更具体。

## 项目的四个运行单元

| 运行单元 | 主要目录 | 主要职责 | 不负责什么 |
| --- | --- | --- | --- |
| 桌面 React UI | `agent-gui/src` | 页面、聊天状态、模型调用编排、工具注册、流式消息渲染 | 不直接持有 PTY、SQLite、SSH socket 等系统资源 |
| Tauri/Rust 宿主 | `agent-gui/src-tauri/src` | IPC command、SQLite、文件/进程/终端、Memory、Skills、Gateway 长连接 | 不负责主要聊天界面的 React 渲染 |
| Go Gateway | `agent-gateway` | gRPC 接入桌面 Agent、HTTP/WebSocket 服务浏览器、会话路由与远程队列 | 不直接调用模型或执行桌面本地工具 |
| Gateway Web UI | `agent-gateway/web` | 浏览器登录、远程聊天、历史记录和远程项目工具界面 | 不具备 Tauri API，实际操作经 Gateway 转发给桌面端 |

最重要的边界是：模型执行与本地工具执行仍发生在桌面 Agent 一侧；Gateway 负责连接、排队、转发和同步，Web UI 是远程控制面。

## 推荐学习路线

### 路线 A：首次完整通读

按章节编号阅读：

1. 先完成第 1～3 章，能够运行项目并理解一次请求；
2. 阅读第 4～8 章，掌握 UI、Runtime、Provider、Tools、Skills 和 MCP；
3. 阅读第 9～12 章，理解持久化、后台能力、Rust 后端和 Gateway；
4. 阅读第 13～16 章，补齐工程工具、配置、测试、排障和扩展能力。

### 路线 B：前端与 Chat Runtime 开发

推荐顺序：第 1 章 → 第 2 章 → 第 3 章 → 第 4 章 → 第 5 章 → 第 6 章 → 第 7 章 → 第 9 章 → 第 12 章。重点关注 React 状态、transcript、流式事件、Provider 适配和桌面/Web 双端一致性。

### 路线 C：后端与基础设施开发

推荐顺序：第 1 章 → 第 2 章 → 第 11 章 → 第 12 章 → 第 13 章 → 第 9 章 → 第 10 章 → 第 15 章。重点关注 Rust state、资源生命周期、SQLite、gRPC/WebSocket、会话路由、终端和构建发布。

## 章节索引

1. [项目导读、环境与首次运行](01-project-overview-and-setup.md)
2. [总体架构与仓库地图](02-architecture-and-repository-map.md)
3. [一次 Agent 请求的完整生命周期](03-agent-request-lifecycle.md)
4. [前端应用外壳与聊天界面](04-frontend-shell-and-chat-ui.md)
5. [Chat Runtime、上下文与 Hooks](05-chat-runtime-and-context.md)
6. [模型 Provider 与流式处理](06-model-providers-and-streaming.md)
7. [Builtin Tools、审批与安全边界](07-tools-and-approval.md)
8. [Skills 与 MCP](08-skills-and-mcp.md)
9. [Memory、History 与 Compaction](09-memory-history-and-compaction.md)
10. [Subagents、Hooks 与自动化](10-subagents-hooks-and-automation.md)
11. [Tauri/Rust 后端分层](11-tauri-rust-backend.md)
12. [Go Gateway 与 Web UI](12-gateway-and-webui.md)
13. [工作区、终端、Git、SSH、SFTP 与隧道](13-workspace-terminal-git-ssh.md)
14. [设置、存储、国际化与平台差异](14-settings-storage-i18n-platform.md)
15. [测试、构建与发布](15-testing-build-and-release.md)
16. [综合排障与功能扩展](16-troubleshooting-and-extension.md)

## 按功能查找

| 功能 | 主章节 | 建议搭配阅读 |
| --- | --- | --- |
| Chat 输入、消息和渲染 | [第 4 章](04-frontend-shell-and-chat-ui.md) | 第 3、5 章 |
| Chat Runtime 与回合队列 | [第 5 章](05-chat-runtime-and-context.md) | 第 3、9 章 |
| Providers、Thinking、搜索、附件 | [第 6 章](06-model-providers-and-streaming.md) | 第 5 章 |
| Builtin Tools 与审批 | [第 7 章](07-tools-and-approval.md) | 第 11、13 章 |
| Skills | [第 8 章](08-skills-and-mcp.md) | 第 7、11 章 |
| MCP | [第 8 章](08-skills-and-mcp.md) | 第 6、7 章 |
| Memory | [第 9 章](09-memory-history-and-compaction.md) | 第 5、11 章 |
| History | [第 9 章](09-memory-history-and-compaction.md) | 第 3、11 章 |
| Context Compaction | [第 9 章](09-memory-history-and-compaction.md) | 第 5、6 章 |
| Subagents | [第 10 章](10-subagents-hooks-and-automation.md) | 第 7、9、13 章 |
| Hooks、Todo、Cron | [第 10 章](10-subagents-hooks-and-automation.md) | 第 5、11 章 |
| Workspace 与文件编辑 | [第 13 章](13-workspace-terminal-git-ssh.md) | 第 7、11 章 |
| Terminal 与后台进程 | [第 13 章](13-workspace-terminal-git-ssh.md) | 第 11、12 章 |
| Git | [第 13 章](13-workspace-terminal-git-ssh.md) | 第 11、12 章 |
| SSH、SFTP | [第 13 章](13-workspace-terminal-git-ssh.md) | 第 7、11、12 章 |
| Tunnel | [第 13 章](13-workspace-terminal-git-ssh.md) | 第 11、12 章 |
| Settings 与配置同步 | [第 14 章](14-settings-storage-i18n-platform.md) | 第 11、12 章 |
| Gateway | [第 12 章](12-gateway-and-webui.md) | 第 3、11 章 |
| Gateway Web UI | [第 12 章](12-gateway-and-webui.md) | 第 4、13、14 章 |
| Build 与 Release | [第 15 章](15-testing-build-and-release.md) | 第 1、11、12 章 |

## 按技术栈查找

| 技术 | 最重要的章节 | 代码入口 |
| --- | --- | --- |
| React / TypeScript | 第 3～10、13～14 章 | [`agent-gui/src/main.tsx`](../../agent-gui/src/main.tsx)、[`agent-gui/src/pages/ChatPage.tsx`](../../agent-gui/src/pages/ChatPage.tsx) |
| Tauri | 第 2、11、13～15 章 | [`agent-gui/src-tauri/src/lib.rs`](../../agent-gui/src-tauri/src/lib.rs) |
| Rust | 第 9～15 章 | [`agent-gui/src-tauri/src/commands`](../../agent-gui/src-tauri/src/commands)、[`runtime`](../../agent-gui/src-tauri/src/runtime)、[`services`](../../agent-gui/src-tauri/src/services) |
| Go | 第 12、15 章 | [`agent-gateway/cmd/gateway/main.go`](../../agent-gateway/cmd/gateway/main.go) |
| gRPC / Protobuf | 第 11、12、15 章 | [`agent-gateway/proto/v1/gateway.proto`](../../agent-gateway/proto/v1/gateway.proto) |
| WebSocket | 第 3、12～14 章 | [`agent-gateway/internal/server/websocket.go`](../../agent-gateway/internal/server/websocket.go) |
| SQLite | 第 9、11、14 章 | [`history_db.rs`](../../agent-gui/src-tauri/src/commands/history/history_db.rs)、[`settings/db.rs`](../../agent-gui/src-tauri/src/commands/config/settings/db.rs) |

## 开发命令速查

以下命令均从仓库根目录运行：

```powershell
# 桌面开发
pnpm --dir agent-gui install
pnpm --dir agent-gui tauri dev

# 仅构建桌面前端
pnpm --dir agent-gui build

# Gateway 服务
go -C agent-gateway run ./cmd/gateway --token=dev-token --http-addr=:50052 --grpc-addr=:50051

# Gateway Web UI
pnpm --dir agent-gateway/web install
$env:npm_config_proxy_api = "http://localhost:50052"
pnpm --dir agent-gateway/web dev

# 主要验证
pnpm --dir agent-gui test
cargo check --manifest-path agent-gui/src-tauri/Cargo.toml --tests
go -C agent-gateway test ./...
pnpm --dir agent-gateway/web test
```

更完整的构建和发布矩阵见[第 15 章](15-testing-build-and-release.md)。

## 阅读源码的方法

不要从最大的组件开始逐行读。对每项功能使用下面的顺序：

1. 找到用户入口，例如按钮、composer、设置项或 WebSocket request type；
2. 找到组合入口，例如 `ChatPage.send()`、`buildBuiltinToolRegistry()` 或 `GatewayController`；
3. 沿调用链确认真正拥有状态和资源的模块；
4. 反向查看对应测试，理解不允许被破坏的行为；
5. 最后阅读错误分支、取消流程和持久化代码。

判断一个模块职责时，可以连续问三个问题：它接收什么、它改变什么、失败时由谁恢复。只要这三个答案清楚，源码规模再大也不会失去方向。

如果你已经遇到具体故障，先到[第 16 章](16-troubleshooting-and-extension.md)按症状定位最后一个成功边界；如果准备修改功能，则先用其中的扩展决策表确定入口，再回到对应主题章阅读实现细节。
