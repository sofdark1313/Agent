# 第 1 章：项目导读、环境与首次运行

## 本章目标

读完本章后，你应当能够说明 Agent 项目的用途，安装必要依赖，分别启动桌面端、Gateway 和 Web UI，并知道出现问题时应先观察哪个进程。

## 先读哪些文件

- [`agent-gui/README.md`](../../agent-gui/README.md)：桌面端最短说明；
- [`Makefile`](../../Makefile)：仓库统一开发、构建和发布入口；
- [`agent-gui/package.json`](../../agent-gui/package.json)：桌面前端依赖与脚本；
- [`agent-gui/src-tauri/Cargo.toml`](../../agent-gui/src-tauri/Cargo.toml)：Rust/Tauri 能力清单；
- [`agent-gateway/go.mod`](../../agent-gateway/go.mod)：Gateway 的 Go 版本和服务端依赖；
- [`agent-gateway/web/package.json`](../../agent-gateway/web/package.json)：远程 Web UI 依赖与脚本；
- [`Dockerfile`](../../Dockerfile)：Gateway 容器构建方式。

## 1. 项目解决什么问题

Agent 是一个桌面 Agent 客户端，同时提供远程访问能力。桌面端不仅显示聊天内容，还承担模型请求编排、工具调用、本地文件与终端操作、Skills/MCP、记忆和历史记录等职责。

当配置远程 Gateway 后，浏览器可以通过 Web UI 操作已连接的桌面 Agent。浏览器不会直接获得本机文件和终端权限，而是把命令发给 Gateway，再由 Gateway 转发给桌面端执行。这使项目形成两条使用路径：

- **本地路径**：用户操作桌面 React UI，Tauri/Rust 直接操作本机资源；
- **远程路径**：用户操作浏览器 Web UI，Go Gateway 路由请求，桌面 Agent 领取并执行。

这两个路径最终共享桌面端的实际执行能力，因此远程功能不是第二套 Agent Runtime，而是同一 Runtime 的远程控制面。

## 2. 技术栈与版本来源

| 层次 | 主要技术 | 版本应从哪里确认 |
| --- | --- | --- |
| 桌面 UI | React 19、TypeScript、Vite、Tailwind、Streamdown | `agent-gui/package.json` |
| 桌面宿主 | Tauri 2、Rust 2021 edition、Tokio、rusqlite、portable-pty、russh | `agent-gui/src-tauri/Cargo.toml` |
| Gateway | Go、gRPC、Gorilla WebSocket、HTTP | `agent-gateway/go.mod` |
| Gateway Web UI | React 19、TypeScript、Vite、XTerm、Monaco | `agent-gateway/web/package.json` |
| 协议 | Protobuf/gRPC、JSON WebSocket envelope | `agent-gateway/proto/v1/gateway.proto`、`internal/server/websocket*.go` |

锁文件决定实际安装版本，`package.json` 中的范围只表示允许范围。排查“同样代码、不同机器行为不同”时，应同时比较 Node/pnpm 版本和锁文件是否一致。

## 3. 开发环境准备

### 3.1 必需工具

1. **Node.js 与 pnpm**：两个 React 工程都使用 pnpm 脚本；
2. **Rust 与 Cargo**：构建 Tauri 后端；
3. **Go 1.25.12 或兼容版本**：版本声明在 `agent-gateway/go.mod`；
4. **平台编译工具**：Windows 需要 MSVC 与 WebView2，macOS 需要 Xcode Command Line Tools，Linux 需要 Tauri 对应的 WebKit/GTK 系统依赖。

只有在重新生成 gRPC 代码时才需要 `protoc`、`protoc-gen-go` 和 `protoc-gen-go-grpc`。只有构建或验证 Gateway 容器时才需要 Docker。

### 3.2 安装 JavaScript 依赖

在仓库根目录执行：

```powershell
pnpm --dir agent-gui install
pnpm --dir agent-gateway/web install
```

两个前端工程有独立锁文件和依赖目录，不能只在根目录执行一次安装。若组织级 pnpm 策略提示 `ERR_PNPM_IGNORED_BUILDS`，先确认被阻止的依赖安装脚本是否确实为项目所需，不要为了消除提示直接全局允许未知脚本。

### 3.3 Rust 与 Go 依赖

Cargo 和 Go 会在首次构建时自动解析依赖，也可以提前执行：

```powershell
cargo fetch --manifest-path agent-gui/src-tauri/Cargo.toml
go -C agent-gateway mod download
```

## 4. 四条最小运行路径

### 4.1 启动桌面应用

```powershell
pnpm --dir agent-gui tauri dev
```

这条命令由 Tauri CLI 启动：

1. 根据 [`tauri.conf.json`](../../agent-gui/src-tauri/tauri.conf.json) 运行 `pnpm dev`；
2. Vite 在 `http://localhost:1420` 提供前端；
3. Cargo 编译并启动 Rust 宿主；
4. Tauri 创建桌面窗口并加载 Vite 页面。

成功标志是出现 Agent 桌面窗口，并且启动终端没有 Rust panic。仅运行 `pnpm --dir agent-gui dev` 只能看到浏览器前端，依赖 Tauri `invoke()` 的功能不会完整工作。

### 4.2 启动 Go Gateway

```powershell
go -C agent-gateway run ./cmd/gateway `
  --token=dev-token `
  --http-addr=:50052 `
  --grpc-addr=:50051
```

Gateway 同时启动两个服务：

- `:50051`：供桌面 Agent 连接的 gRPC 服务；
- `:50052`：供浏览器使用的 HTTP、WebSocket 和静态 Web UI 服务。

成功时日志会分别出现 `gRPC listening` 和 `HTTP listening`。访问 `http://localhost:50052/healthz` 应返回健康状态。

### 4.3 启动 Gateway Web UI 开发服务器

PowerShell 中执行：

```powershell
$env:npm_config_proxy_api = "http://localhost:50052"
pnpm --dir agent-gateway/web dev
```

Vite 开发服务器提供浏览器页面，并把 API/WebSocket 请求指向本地 Gateway。登录 token 使用前一步的 `dev-token`。生产构建时 Web UI 会被编译到 `agent-gateway/web/dist`，再由 Go 的 `embed` 打入 Gateway 二进制。

### 4.4 只运行桌面前端

```powershell
pnpm --dir agent-gui dev
```

这条路径适合查看纯 React 布局或样式，但不能作为完整功能验证。源码中虽然对 `isTauri()` 做了部分保护，大量文件、设置、历史和系统能力仍需要 Rust 宿主。

## 5. 运行模式与平台配置

基础窗口和构建命令来自 [`tauri.conf.json`](../../agent-gui/src-tauri/tauri.conf.json)，平台文件在构建时合并：

- Windows：[`tauri.windows.conf.json`](../../agent-gui/src-tauri/tauri.windows.conf.json)，关闭系统装饰，由 React 绘制标题栏，输出 NSIS/MSI；
- macOS：[`tauri.macos.conf.json`](../../agent-gui/src-tauri/tauri.macos.conf.json)，使用 Overlay title bar 和 Traffic Lights，输出 app/DMG；
- Linux：基础配置加 release 配置，输出 AppImage、deb、rpm。

根目录 [`Makefile`](../../Makefile) 把这些差异封装成 `desktop-build-windows`、`desktop-build-macos`、`desktop-build-linux` 等目标。Windows 没有 GNU Make 时，可以读取目标中的底层 pnpm/cargo/go 命令直接执行。

## 6. 第一次调试应该观察什么

### 6.1 浏览器或 WebView 控制台

适合观察 React 错误、Provider 请求异常、流式事件、状态更新和 Tauri `invoke()` 拒绝。聊天能发送但界面不刷新时，先从这里确认事件是否进入前端。

### 6.2 启动桌面端的 Rust 终端

适合观察 SQLite 初始化、Skills seed、Gateway controller、文件/终端/SSH 资源错误和 Rust panic。UI 提示“后端调用失败”时，应同时查看这里的底层错误。

### 6.3 Gateway 日志

适合观察 gRPC/HTTP 监听、桌面 Agent 上下线、WebSocket 断线、认证失败和远程命令超时。Web UI 显示离线时，先确认 Gateway 是否仍看到桌面 session。

### 6.4 本地数据目录

项目把主要持久化数据放在用户目录下的 `.agent`：

- `.agent/config.sqlite`：Provider、系统、MCP、Agent 模板、SSH、Remote、Memory 设置；
- `.agent/chat-history.sqlite3`：对话、segment、FTS、分享状态和 Subagent 持久化；
- `.agent/memory/`：Memory Markdown 事实源和 `memory-index.sqlite3` 索引；
- `.agent/default-project/`：未显式选择项目时的默认工作目录。

不要在应用运行时随意删除这些文件。排障章节会说明如何先备份、如何区分可重建索引与事实源。

## 7. 开发入口的设计亮点

1. **统一 Makefile，但不掩盖子项目边界**：开发者可以用统一目标，也能独立运行每个子项目；
2. **桌面和远程共享实际执行端**：避免在服务器复制一整套高权限工具运行时；
3. **Web UI 静态嵌入 Gateway**：生产部署只需一个 Go 二进制及必要配置；
4. **平台配置分层合并**：共享应用逻辑的同时，保留标题栏、图标和安装包差异。

## 验证与扩展

- 关键验证：`pnpm --dir agent-gui build`、`cargo check --manifest-path agent-gui/src-tauri/Cargo.toml --tests`、`go -C agent-gateway test ./...`。
- 修改入口：开发命令优先修改根目录 `Makefile` 和各子项目 `package.json`，平台打包修改对应 `tauri.*.conf.json`。
- 练习：启动桌面端后找到 Vite、Rust 和 React 三段启动日志，并说明每段日志属于哪个运行单元。

[前置：返回总览](README.md) · [相关：测试、构建与发布](15-testing-build-and-release.md) · [下一章：总体架构与仓库地图](02-architecture-and-repository-map.md)
