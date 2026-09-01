# Agent 🤖

> 一款专为软件研发与自动化打造的高性能、跨平台 AI 智能体应用平台（提供原生桌面端、远程 Web 控制台及云端网关服务）。

[![GitHub Release](https://img.shields.io/github/v/release/sofdark1313/Agent?color=blue&logo=github)](https://github.com/sofdark1313/Agent/releases)
[![Docker Image](https://img.shields.io/badge/Docker-ghcr.io-2496ED?logo=docker&logoColor=white)](https://github.com/sofdark1313/Agent/pkgs/container/agent-gateway)
[![Platform Support](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-brightgreen)](#-支持平台与安装包下载)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 📥 支持平台与安装包下载

前往 [**GitHub Releases 页面**](https://github.com/sofdark1313/Agent/releases) 获取各平台最新版本安装包：

| 操作系统 / 平台 | 推荐下载格式 | 适用环境 / 说明 |
| :--- | :--- | :--- |
| 🪟 **Windows** | `Agent_x.x.x_x64-setup.exe` | Windows 10 / 11 推荐，双击即装 |
| 🪟 **Windows (MSI)** | `Agent_x.x.x_x64_en-US.msi` | Windows 企业级静默部署 / MSI 安装包 |
| 🍏 **macOS (Apple Silicon)** | `Agent_x.x.x_aarch64.dmg` | 苹果 M1 / M2 / M3 / M4 芯片 Mac |
| 🍎 **macOS (Intel)** | `Agent_x.x.x_x64.dmg` | 传统 Intel 芯片 Mac |
| 🐧 **Ubuntu / Debian** | `Agent_x.x.x_amd64.deb` | `sudo apt install ./Agent_x.x.x_amd64.deb` |
| 🐧 **Fedora / CentOS** | `Agent-x.x.x-1.x86_64.rpm` | `sudo dnf install ./Agent-x.x.x-1.x86_64.rpm` |
| 🐧 **Linux 通用免安装** | `Agent_x.x.x_amd64.AppImage` | `chmod +x` 后直接双击运行 |

---

## 🐳 Docker 一键部署云端网关服务 (Gateway & WebUI)

无需安装 Go 或 Node.js 环境，直接通过 Docker 镜像一键启动云端网关和内嵌的完整 Web 控制台：

### 1. 一行命令直接运行
```bash
docker run -d \
  --name agent-gateway \
  --restart unless-stopped \
  -p 50052:8080 \
  -p 50051:50051 \
  ghcr.io/sofdark1313/agent-gateway:latest \
  --token "your-access-token"
```

### 2. 使用 Docker Compose 运行
创建 `docker-compose.yml`：
```yaml
services:
  agent-gateway:
    image: ghcr.io/sofdark1313/agent-gateway:latest
    container_name: agent-gateway
    restart: unless-stopped
    ports:
      - "50052:8080"   # WebUI 网页控制台访问端口
      - "50051:50051"  # gRPC 远程中继通信端口
    command: ["--token", "your-access-token"]
```

启动服务：
```bash
docker compose up -d
```

> 🌐 **访问控制台**：启动后，在浏览器访问 `http://服务器IP:50052` 即可直接进入与桌面端完全一致的高保真 Web 控制台界面！

---

## 🌟 核心特性

### 1. 现代化智能体对话与执行引擎 (Smart Chat & Execution Engine)
- **多模型无缝接入**：原生支持 OpenAI、Anthropic (Claude)、Google (Gemini)、Mistral、DeepSeek 及各类自定义/代理供应商模型。
- **深度思维与推理展示**：流式展示思考链（Thinking/Reasoning）、Token 消耗统计、结构化工具调用（Tool Calls）与执行结果（Tool Results）。
- **富文本与代码渲染**：集成 Streamdown、Monaco 代码编辑器、LaTeX 数学公式（KaTeX）、Mermaid 架构流程图渲染与文档文件预览（Word、Excel 等）。
- **项目工作区多层级管理**：支持多项目（Projects）并行展开与独立会话管理、双击重命名、置顶收藏与模糊检索。

### 2. 完备的工程研发工作台 (Developer Dock Tools)
- **终端系统 (Integrated Terminal)**：基于 `portable-pty` 与 `xterm.js` 实现的完整本地/远程终端会话。
- **文件树与代码编辑 (File Tree & Editor)**：工作区目录树浏览、代码高亮查看与即时编辑。
- **Git 版本审查 (Git Review)**：精细化 Diff 对比视图、修改文件列表审查与分支状态管理。
- **后台任务监控 (Background Tasks)**：实时查看与管理长时间运行的后台进程与异步任务。
- **SSH / 本地隧道 (Tunnels)**：支持 SSH 会话与 SFTP 文件传输，轻松穿透内网调试。
- **MCP 协议桥接 (Model Context Protocol)**：内置标准化 MCP 插件与扩展支持。

### 3. 任务调度与自动化增强 (Automation & Superpowers)
- **Skills 技能系统**：支持用户自定义扩展技能包，动态赋予 AI 针对特定技术栈的解决能力。
- **定时调度任务 (Cron Tasks)**：内置基于 Cron 表达式的定时任务引擎，支持定时触发、状态监听与自动化运维。
- **子智能体协同 (Subagents)**：支持多 Agent 分工协同与任务委派。
- **系统 Hooks & 记忆库**：提供全局提示词模板、上下文记忆存储（SQLite / LevelDB）与生命周期钩子。

### 4. 远程控制与网关服务 (Remote Gateway & WebUI)
- **远程会话中继**：通过高性能 Go gRPC Gateway 建立本地客户端与云端服务之间的双向安全长连接。
- **浏览器完整控制台**：拥有与桌面端完全一致的高保真 Web 界面，随时随地在浏览器中继续对话与操控。
- **安全身份验证**：基于 Access Token 与安全加密传输，保证远程连接私密性。

---

## 🏗️ 系统架构与技术栈

```
┌─────────────────────────────────────────────────────────────┐
│                       Client Layer                          │
│  ┌───────────────────────────────┐  ┌────────────────────┐  │
│  │   Desktop App (agent-gui)     │  │ WebUI (gateway/web)│  │
│  │   React 19 + Tauri v2 + Vite  │  │ React 19 + Vite    │  │
│  └───────────────┬───────────────┘  └──────────┬─────────┘  │
└──────────────────┼─────────────────────────────┼────────────┘
                   │ gRPC / WebSocket            │ WebSocket
┌──────────────────▼─────────────────────────────▼────────────┐
│                    Go Agent Gateway                         │
│   - gRPC Server (Tonic / Go gRPC)                           │
│   - WebSocket Relay & Session State Synchronization         │
│   - Embedded Static Web SPA Distribution                    │
└──────────────────┬──────────────────────────────────────────┘
                   │ Local Core Services
┌──────────────────▼──────────────────────────────────────────┐
│                   Desktop Core (Rust / Tauri)                │
│   - Tokio Async Runtime & Axum Internal Services            │
│   - SQLite / LevelDB Local Storage                          │
│   - Portable-PTY Shell Session Manager                      │
│   - Russh (SSH/SFTP) & MCP Protocol Host                    │
│   - Cron Scheduler Engine                                   │
└─────────────────────────────────────────────────────────────┘
```

- **桌面客户端 / 前端 (`agent-gui`)**：React 19, TypeScript, Tailwind CSS v4, Monaco Editor, XTerm.js, Base UI
- **桌面原生核心 (`agent-gui/src-tauri`)**：Rust (Tauri v2), Tokio, Tonic (gRPC), Rusqlite, Portable-PTY, Russh
- **云端网关服务 (`agent-gateway`)**：Go, gRPC, Protobuf, Gorilla WebSocket, 静态资源嵌入
- **远程 Web 控制台 (`agent-gateway/web`)**：React 19, TypeScript, Vite, Tailwind CSS

---

## 📁 目录结构

```text
.
├── agent-gui/                 # 桌面客户端及前端代码
│   ├── src/                   # React 19 前端源码 (组件、页面、状态、国际化)
│   ├── src-tauri/             # Rust 原生后端 (Tauri v2、系统调用、PTY、数据库、gRPC)
│   ├── package.json
│   └── vite.config.ts
├── agent-gateway/             # Go 语言远程网关服务
│   ├── cmd/gateway/           # 网关入口主程序
│   ├── internal/              # 内部服务 (gRPC 中继、WebSocket、认证、配置)
│   ├── proto/                 # gRPC Protobuf 协议定义
│   ├── web/                   # 独立 WebUI 前端源码 (与桌面端共享高保真 UI)
│   └── go.mod
├── .github/workflows/         # CI/CD 自动化多平台发布与 Docker 镜像推送
├── scripts/                   # 代码镜像校验与版本发布工具集
├── Cargo.toml                 # Rust Workspace 配置
├── Dockerfile                 # 多阶段构建轻量 Docker 镜像
└── Makefile                   # 便捷构建指令集合
```

---

## 🚀 本地开发与手动构建

### 环境要求
- **Node.js** >= 20.x
- **pnpm** >= 9.x
- **Rust & Cargo** >= 1.80 (构建桌面端必需)
- **Go** >= 1.22 (运行或构建网关必需)

---

### 1. 桌面端应用 (`agent-gui`)

```bash
# 安装依赖
cd agent-gui
pnpm install

# 启动桌面开发模式 (前端热重载 + Rust 后端编译)
pnpm tauri dev

# 构建前端产物
pnpm build

# 打包桌面端独立可执行安装包
pnpm tauri build
```

---

### 2. 云端网关与 WebUI (`agent-gateway`)

#### 启动 WebUI 开发调试：
```bash
cd agent-gateway/web
pnpm install
pnpm dev
```

#### 编译 WebUI 并启动 Go Gateway 服务：
```bash
# 1. 编译 Web 前端产物
cd agent-gateway/web
pnpm build

# 2. 启动 Gateway 网关 (默认监听 Web: 50052, gRPC: 50051)
cd ../
go run ./cmd/gateway --token "your-access-token"
```

---

## 📄 许可证 (License)

本项目采用 [MIT 许可证](LICENSE) 开源。
