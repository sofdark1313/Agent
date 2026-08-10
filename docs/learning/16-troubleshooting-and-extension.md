# 第 16 章：综合排障与功能扩展

## 本章目标

读完本章后，你应当能够按症状而不是按目录排查问题，快速判断故障发生在 React、Chat Runtime、Tauri/Rust、Gateway、Web UI、外部 Provider 还是操作系统，并能为新增功能选择正确的 registry、page、command、service、protocol 和 test 入口。

本章不是把前十五章重复一遍，而是把它们转成可执行的诊断路径。遇到问题时先确认事实源和最近一个成功边界，再进入具体模块；不要一开始就在最大的组件中搜索错误文案。

## 先读哪些文件

- [`App.tsx`](../../agent-gui/src/App.tsx) 与 [`pages/ChatPage.tsx`](../../agent-gui/src/pages/ChatPage.tsx)；
- [`lib/chat/runner/agentRunner.ts`](../../agent-gui/src/lib/chat/runner/agentRunner.ts) 与 [`pages/chat/queue/chatTurnQueue.ts`](../../agent-gui/src/pages/chat/queue/chatTurnQueue.ts)；
- [`lib/tools/builtinRegistry.ts`](../../agent-gui/src/lib/tools/builtinRegistry.ts) 与 [`lib/tools/toolApprovalPolicy.ts`](../../agent-gui/src/lib/tools/toolApprovalPolicy.ts)；
- [`src-tauri/src/lib.rs`](../../agent-gui/src-tauri/src/lib.rs)、[`runtime`](../../agent-gui/src-tauri/src/runtime) 与 [`services`](../../agent-gui/src-tauri/src/services)；
- [`agent-gateway/internal/server`](../../agent-gateway/internal/server) 与 [`internal/session`](../../agent-gateway/internal/session)；
- [`agent-gateway/web/src/lib/gatewaySocket.ts`](../../agent-gateway/web/src/lib/gatewaySocket.ts)；
- [`Makefile`](../../Makefile)、[`agent-gui/package.json`](../../agent-gui/package.json) 与 [`agent-gateway/web/package.json`](../../agent-gateway/web/package.json)。

## 1. 统一排障方法：找最后一个已确认成功的边界

一次功能通常跨越多个边界：

```mermaid
flowchart LR
    Action["用户操作"] --> UI["React 状态 / 表单"]
    UI --> Runtime["Chat Runtime / Client adapter"]
    Runtime --> IPC["Tauri invoke/event 或 WebSocket"]
    IPC --> Backend["Rust command/service 或 Go handler"]
    Backend --> Resource["SQLite / 文件 / 进程 / SSH / Provider"]
    Resource --> Event["结果、snapshot、stream、error"]
    Event --> Render["Reducer / Store / UI 渲染"]
```

排查时对每条箭头收集证据：

1. 用户动作是否真的触发 handler；
2. handler 构造的 payload 是否正确；
3. 请求是否到达下一层，request/session/run id 是否一致；
4. 状态所有者是否接受了请求；
5. 外部资源是否成功；
6. 返回的是正常结果、业务错误、取消、超时还是连接中断；
7. UI 是否消费了结果，还是被 epoch/revision/cursor 判定为陈旧。

最有价值的日志字段不是长错误堆栈，而是稳定关联 id：conversation id、run id、client request id、tool call id、session id、project path key、Gateway request id、stream epoch/seq 和 settings revision。

## 2. 快速症状索引

| 症状 | 先确认 | 最可能的事实源 | 主章节 |
| --- | --- | --- | --- |
| 应用无法启动 | Vite、Rust 终端、WebView 是否任一成功 | Tauri setup、配置数据库、系统依赖 | [第 1、11 章](11-tauri-rust-backend.md) |
| 模型无响应 | 回合是否进入 queue、Provider 是否发出首个事件 | Chat Runtime / Provider adapter | [第 5、6 章](06-model-providers-and-streaming.md) |
| 流式输出中断 | 是 Provider 断流、取消还是 UI 丢 cursor | Provider stream / Gateway stream | [第 6、12 章](12-gateway-and-webui.md) |
| 工具不出现 | catalog、selection、execution mode、remote capability | Builtin Registry | [第 7 章](07-tools-and-approval.md) |
| 审批卡住 | Broker 是否有 pending、run 是否仍有效 | Approval broker / turn cancellation | [第 7 章](07-tools-and-approval.md) |
| MCP/Skill 加载失败 | discovery、validation、server/job status | Skills service / MCP runtime | [第 8 章](08-skills-and-mcp.md) |
| Memory 不写入 | extraction gating、plan、mutation result | Memory pipeline / Rust store | [第 9 章](09-memory-history-and-compaction.md) |
| History/Compaction 异常 | active segment、persist queue、checkpoint | History DB / compaction controller | [第 9 章](09-memory-history-and-compaction.md) |
| Gateway 离线 | desktop controller、gRPC auth、Agent registry | GatewayController / session.Manager | [第 12 章](12-gateway-and-webui.md) |
| Terminal/SSH/SFTP 失败 | session snapshot、connection id、prompt | Rust Terminal/SFTP registry | [第 13 章](13-workspace-terminal-git-ssh.md) |
| 设置不同步 | 本地保存、公开 payload、incoming event | Settings save chain / Gateway snapshot | [第 14 章](14-settings-storage-i18n-platform.md) |
| 构建失败 | 命令是否进入 compiler/test、缺哪个前置条件 | package script / Cargo / Go / bundler | [第 15 章](15-testing-build-and-release.md) |

## 3. 应用无法启动

按启动阶段逐层检查：

### 3.1 前端 dev server 没起来

- `pnpm --dir agent-gui tauri dev` 是否先成功执行 `pnpm dev`；
- 1420 端口是否被占用；
- pnpm install 是否完整，Vite 是否能解析所有依赖；
- TypeScript/Vite 报错属于前端构建阶段，此时 Rust window 可能根本没有加载页面。

先单独运行 `pnpm --dir agent-gui build`。如果失败，先解决前端类型/模块问题，不要在 Tauri setup 中寻找原因。

### 3.2 Rust binary 启动但窗口不显示

- 查看 `src-tauri/src/lib.rs` 的 setup 日志，确认 History DB、proxy、Gateway controller 等初始化到哪一步；
- 主窗口可能已被关闭并隐藏到托盘，先检查 tray，而不是认为进程已退出；
- Windows 自绘标题栏与 decorations、macOS overlay、Linux WebKit 依赖都可能造成平台专用问题；
- 配置数据库或默认目录失败通常应降级，不应让整个 Builder panic。若确实 panic，定位 setup 中使用 `expect` 的不可恢复前置条件。

### 3.3 只在某个平台失败

核对实际合并的 Tauri config 和 Rust target。Windows manifest、macOS PATH/traffic lights/hardened runtime、Linux WebKit/bundler 是不同链路。不要用 Windows 上 `pnpm build` 成功推断 macOS DMG 能签名。

## 4. 模型无响应或流式输出中断

### 4.1 模型无响应

用下面的阶段定位：

1. `ChatPage.send()` 是否构造了非空用户内容并调用 turn queue；
2. queue 是否处于等待其他回合、审批、取消或 Gateway GUI queue；
3. `agentRunner` 是否完成 context、tools、skills、memory 与附件组装；
4. selected model 是否仍指向启用的 Provider/model；
5. Provider adapter 是否真正发出 HTTP 请求；
6. 是否收到首个 thinking/text/search/tool event；
7. error 是否被转成 transcript 状态，而不是只写 console。

常见原因包括 API key configured 但本地真实 key 已清空、base URL 路由错误、模型不支持当前 thinking/tool 模式、附件超限、上一个 run 未释放，或请求被编辑重发后的 epoch 判为陈旧。

### 4.2 流式输出中断

先区分四种终止：

| 类型 | 证据 | 恢复方向 |
| --- | --- | --- |
| 用户取消 | AbortSignal、cancel event、run state cancelled | 检查取消是否只影响目标 scope |
| Provider 正常结束但缺 terminal event | source closed、已有内容、无明确 error | 检查 text-mode/stream recovery |
| Provider 网络断流 | retryable error、未完成 usage/completion | 检查 retry policy 与幂等边界 |
| Gateway/Web UI 丢流 | seq gap、epoch reset、reconnect | subscribe cursor → replay/reset/snapshot |

本地回合应查看 Provider stream parser 和 `agentRunner`；远程回合还要检查 Gateway conversation log、browser `lastSeq + streamEpoch`、desktop runtime snapshot。不要通过“把最后一条消息标记完成”掩盖缺口，否则 History 会持久化一个表面成功但内容不完整的回合。

## 5. 工具不出现或审批卡住

### 5.1 工具不出现

从组合入口 `buildBuiltinToolRegistry()` 反向检查：

1. catalog 中是否声明工具；
2. execution mode 是否允许；
3. Settings 的 selected system tools 是否启用；
4. 项目、SSH host、MCP server、Skill、Memory 或 Remote capability 等动态前置条件是否满足；
5. 当前模型是否支持原生 tool call，文本模式 recovery 是否启用；
6. Web UI route/Rust Gateway bridge 是否提供该工具依赖的 backend；
7. schema 是否可序列化，重复 name 是否被后注册项覆盖或拒绝。

工具“未注册”和“已注册但模型没调用”是两类问题。先在本轮 model request 的 tools 数组中确认它是否存在，再分析模型行为。

### 5.2 审批卡住

- `ToolApprovalBroker` 是否仍保存对应 tool call id；
- approval card 是否渲染在当前 active run，而不是旧 segment；
- 用户响应是否 resolve/reject 了同一个 Promise；
- run 被取消、切会话或编辑重发时，pending approval 是否被统一清理；
- Gateway 远程场景中，审批展示在哪个桌面 UI，Web UI 是否只收到 waiting 状态；
- command 超时与 approval 超时不要混为一谈：前者发生在执行后，后者发生在执行前。

如果审批 UI 消失但 runner 仍等待，通常是 broker 生命周期与 transcript 生命周期脱节。修复应让取消/卸载释放 pending，而不是简单增加更长 timeout。

## 6. MCP 或 Skill 加载失败

### 6.1 Skill

按 discovery → metadata → validation → access policy → load 的顺序检查：

- `SKILL.md` 是否存在、metadata 是否合法；
- source 路径是否在允许根目录，压缩包是否存在路径穿越；
- 安装 job 是 queued/running/failed 还是已完成但索引未刷新；
- 临时目录与原子替换是否成功，Windows 文件占用是否阻止 rename；
- 当前回合是否显式提到 Skill，披露策略是否允许读取资源；
- builtin、external、ClawHub 来源是否走了正确更新路径。

失败后不要直接编辑 Skills 索引缓存。文件内容是事实源，索引和 discovery 应可重建。

### 6.2 MCP

- Settings 中 server 是否启用，command/url/transport 是否通过 normalize；
- stdio server 程序能否在应用环境 PATH 中找到；
- server 是否启动后立即退出，stderr 是否有依赖或认证错误；
- discovery 返回的 tool schema 是否能转换为模型工具；
- tool call 是连接失败、超时、schema mismatch 还是 server 返回业务错误；
- stop/restart 是否清理旧 process 与 pending call。

macOS 从 Dock 启动时 PATH 与 Terminal 不同，是“命令行能启动 MCP，应用里找不到”的高频原因；检查 Rust 的 PATH augment，而不是要求用户把绝对路径写进每项配置。

## 7. Memory 不写入、History 或 Compaction 异常

### 7.1 Memory 不写入

Memory pipeline 不是每轮必写。依次确认：

1. Memory 是否启用，当前 scope/workdir 是否允许；
2. extraction gating 是否认为本轮存在稳定、可复用信息；
3. prompt/model 是否成功返回 plan；
4. plan 是否被 schema validation 接受；
5. mutation risk 是否拒绝删除、覆盖或低证据更新；
6. Markdown 文件写入是否成功；
7. SQLite 索引是否更新，或是否只是索引失败但文件已写；
8. organizer quota/review state 是否把条目留在待审状态。

文件是 Memory 事实源，SQLite 是可重建索引。若文件存在但 UI 搜不到，优先排查索引；若 plan 为空，优先排查 gating 和模型输出；不要把两者混在一起重写整个 store。

### 7.2 History 异常

- conversation、segment、message 与 active segment 是否一致；
- persist queue 是否按序写入，旧回调是否覆盖新 segment；
- rename/pin/delete/share 是 UI 状态失败还是 SQLite transaction 失败；
- FTS 查询异常时，原始 conversation/message 表是否仍正确；
- Gateway history sync 是否携带 revision/snapshot，远端缓存是否陈旧。

History 写入位于回合关键路径时要报告失败，但标题生成、分享或索引等派生任务失败不应把已完成模型回合改成失败。

### 7.3 Compaction 异常

检查 trigger policy、token ledger、summary engine、checkpoint、payload rebuild 和 file ledger 六个阶段。常见症状：

- 过早压缩：token estimate 或阈值错误；
- 一直不压缩：in-flight/tool round gating 未释放；
- 压缩后丢工具上下文：payload rebuild 未保留必要 tool result；
- summary 太短或无证据：summarizer validation 拒绝后是否正确回退；
- 重启后重复压缩：checkpoint 未持久化或 active segment 不一致；
- 文件修改上下文丢失：file ledger merge/truncation 顺序错误。

压缩失败应回退原始上下文或保留上一个 checkpoint，不能把半成品 summary 当成成功结果写入 History。

## 8. Gateway 离线或 Web UI 不工作

按连接方向拆分：

### 8.1 Desktop → Gateway

- Remote Settings 是否 enabled，地址、TLS、token 是否已 `apply_config()`；
- `GatewayController.status()` 是 connecting、online、backoff 还是 auth failure；
- gRPC metadata token 是否正确，证书与 hostname 是否匹配；
- AgentConnect stream 是否建立，heartbeat 是否持续；
- 系统 resume 后 `nudge_connection()` 是否触发；
- 同一 agent id 的新 connection epoch 是否已替换旧连接。

### 8.2 Browser → Gateway

- HTTP `/healthz` 与认证 `/api/status` 分别是否成功；
- WebSocket 第一帧 auth 是否发送，origin 是否允许；
- `GatewaySocket` 的 request id 是否有 pending Promise；
- 控制队列是否被慢 stream 数据挤压；
- browser tab 从后台恢复后是否重连和重订阅；
- Web UI 静态资源是否真的嵌入当前 Go binary，而不是旧 `web/dist`。

### 8.3 Gateway 在线但 Agent 功能不可用

Go 进程健康不等于桌面 Agent 在线。检查 `session.Manager` 的 agent registry 和 capability snapshot。Terminal、Git、SFTP、Tunnel 还受 Remote capability 开关控制；浏览器能打开页面却无法操作项目，可能只是没有在线 Agent 或该能力被禁用。

远程 Chat 卡住时追踪 enqueue → accepted → claim → lease → local_started → stream → complete。lease/heartbeat 失败应允许重领或明确失败，不能同时让两个桌面 run 执行同一请求。

## 9. Terminal、SSH 或 SFTP 失败

### 9.1 本地 Terminal

- `terminal_create` 是否返回 snapshot；
- session 是否出现在 `terminal_list` 与 `terminal:event`；
- attach snapshot 的 offset 是否与后续 stream 连续；
- 输入是否因 256 KiB high-water 进入 paused；
- shell program 是否能按当前平台 PATH/PATHEXT 解析；
- close 是正常 exit、用户 kill、窗口隐藏，还是应用真正退出清理。

标签不见不代表 PTY 不存在，PTY 退出也不代表标签缓存已更新。始终同时核对 Rust session 与前端 session store。

### 9.2 SSH

- 主机配置与项目关联是否允许当前会话；
- auth type 是 password、private key 还是 keyboard-interactive；
- create 返回的是 snapshot 还是 host-key/auth prompt；
- known host 是首次未知还是 fingerprint changed；
- proxy 连接、TCP、SSH handshake、auth、channel open 分别在哪一步失败；
- reconnect 是否因需要新的 keyboard-interactive 输入而停止。

host key changed 不能通过“自动信任新 key”修复；应让用户 reset 后重新确认。认证失败日志也不能打印 password、private key 或 proxy secret。

### 9.3 SFTP

- Terminal session 是否 running 且启用 SFTP；
- SFTP cached channel 的 `connection_id` 是否与当前 SSH connection 一致；
- 错误是否属于 connection closed，可清缓存重试，还是 permission/not found 业务错误；
- recursive delete/transfer 与 overwrite 是否经过确认；
- transfer 是 queued、running、cancelled 还是 failed，`sftp:event` 是否到达 UI；
-关闭 Terminal 时 transfer 是否被取消。

## 10. 设置不同步

先画出字段的所有者：SQLite、localStorage 还是设备本地。然后检查：

1. `setSettings()` 是否生成了 normalize 后的 next；
2. `saveChainRef` 是否执行到本次 sequence；
3. `persistSettings()` 是否认为字段 changed；
4. Rust save command 是否成功，相关 service 是否 reload/apply config；
5. `buildGatewaySettingsSyncPayload()` 是否包含该字段；
6. secret 是否只以 configured 标志公开，真实更新是否使用一次性字段；
7. Gateway 是否发布了 snapshot/event；
8. `applyGatewaySettingsSyncPayload()` 是覆盖、patch、merge 还是保持本地；
9. Right Dock width、font scale、Chat sidebar 等是否本来就设计为设备本地；
10. SSH patch 是否因 before/current 冲突返回最新 snapshot。

常见误判是把“没有跨设备同步”当 bug，而该字段本来就是设备本地；或者看到 `apiKeyConfigured=true` 就认为 API key 字符串应该出现在 Web payload。脱敏成功时，Web 端恰恰不应能读取 secret。

## 11. 构建或发布失败

先确认失败发生在哪一层：

| 失败阶段 | 典型证据 | 处理 |
| --- | --- | --- |
| pnpm 预检/安装 | 尚未输出 package script 名称 | 处理 lockfile、registry、ignored build 或依赖安装策略 |
| `tsc` | 类型、模块、lib 报错 | 修类型或双端镜像，不要跳过 typecheck |
| Vite | bundle、动态 import、资源路径报错 | 检查 alias、静态资源和依赖 ESM 兼容 |
| Cargo build/check | Rust 类型、feature、build.rs/proto 报错 | 检查 toolchain、proto、target 与系统库 |
| Node test | 明确的 assertion/test name | 修逻辑或测试前置，不能用 build 成功替代 |
| Go test/build | package/test/compile 错误 | 检查生成 proto、race/timeout 和 embed dist |
| Tauri bundle | installer、icon、SDK、target 错误 | 在匹配平台安装 bundler 依赖 |
| 签名/公证 | identity、profile、signature、notary 错误 | 检查证书与外部服务，不修改业务代码绕过 |
| Updater manifest | artifact 或 `.sig` 缺失 | 修产物命名/签名映射，禁止生成 unsigned manifest |

如果 Web UI tests 失败，要看它是否真正进入 `node --test`。包管理器在运行 script 前拒绝依赖状态，不能报告为“303 个测试失败”；反之，某个异步 timing test 偶发失败，也不能用单测单独通过就声称全量稳定，应串行/重复运行并定位竞争条件。

## 12. 功能扩展决策表

| 想增加的能力 | 首要入口 | 后续必须检查 | 最小测试 |
| --- | --- | --- | --- |
| 新 Provider | `lib/providers/llm.ts`、Provider adapter、Settings | thinking、tool mode、search、attachments、retry、redaction | providers tests + GUI build |
| 新流式事件 | Provider runtime event type、`agentRunner` | transcript reducer、History serialize、Gateway proto/Web stream、UI | local + Web transcript tests |
| 新 Builtin Tool | `builtinToolCatalog.ts`、`builtinRegistry.ts` | schema、approval policy、execution mode、remote backend | tools tests +相关 Rust/Go test |
| 新 Rust command | `commands/*` 与 `app_invoke_handler!()` | serde、State owner、blocking 边界、capability、安全校验 | Rust test + adapter test |
| 新长生命周期 service | `services/*`、Tauri managed state | startup order、event、snapshot、recovery、shutdown | service unit + restart test |
| 新 Right Dock 工具 | `rightDockRegistry.tsx`、settings model | keep-alive active、项目 bucket、Web mirror、capability | right-dock tests + build |
| 新设置字段 | `AppSettings`、default、normalize | storage owner、save side effect、sync/merge、i18n、secret | settings sync tests |
| 新 Gateway 请求 | `gateway.proto` 或 WebSocket route | Go session、Rust bridge、Web adapter、auth、timeout/queue | Go + Cargo + Web tests |
| 新 Memory 字段/操作 | Memory schema、plan tool、Rust store | evidence、migration、索引重建、risk policy | Memory Node + Rust tests |
| 新 Cron/Hook 能力 | automation types/store/scheduler | validate、claim、lease、restart recovery、header mask | automation tests |
| 新 Terminal/SSH/SFTP 操作 | client type、Rust registry | stream/backpressure、connection id、cancel、Gateway route | Terminal/SFTP Rust + Web tests |
| 新发布平台/产物 | Tauri release config、Makefile | CI runner、签名、artifact naming、updater key | release tests + 平台 bundle smoke |

### 12.1 扩展功能的通用实现方案

无论新增哪种功能，都先回答六个问题：

1. **入口**：用户从哪个 page、tool 或 protocol 发起？
2. **所有者**：真实状态由 React、Rust service、Go manager 还是外部系统持有？
3. **数据流**：本地和远程路径是否共用同一业务实现？
4. **恢复**：取消、超时、重连、重启和陈旧响应如何处理？
5. **安全**：路径、命令、网络、secret、审批和输出上限在哪里校验？
6. **验证**：哪条测试执行真实逻辑，哪条 build 只验证编译？

如果这六个问题没有答案，直接在 UI 中添加按钮通常只会产生一个“本机演示能用、远程和恢复都不完整”的功能。

### 12.2 双端一致性检查

桌面 React 与 Gateway Web UI 有镜像组件、类型和 adapter。修改前运行：

```powershell
rg -n "MIRROR NOTICE|Keep changes in sync|parity" agent-gui/src agent-gateway/web/src
```

然后判断应该字节级同步、语义同步，还是仅共享类型。不要机械复制 Tauri-only import 到 Web UI；Web 端可能需要 shim 或专用 Gateway client。

## 13. 建议的源码学习实操

完成全书后，选择一个真实但小范围的需求，例如“为 Git status 增加一个只读统计字段”或“为 Gateway 连接状态补一条脱敏日志”，按下面步骤练习：

1. 从 UI 或协议入口画调用链；
2. 标出状态所有者与持久化位置；
3. 找到取消、错误、重连和安全边界；
4. 先补最接近真实逻辑的测试；
5. 实现最小改动；
6. 运行风险矩阵中的验证；
7. 检查桌面/Web 镜像与文档链接。

练习的目标不是增加代码量，而是证明你已经能够预测一个改动会影响哪些层。

## 验证与扩展

- 关键验证：根据症状运行最小相关测试，再执行[第 15 章](15-testing-build-and-release.md)的风险矩阵；不要用无关 build 替代失败测试。
- 修改入口：先从本章扩展决策表选择组合入口，再沿状态所有者扩展 command/service/protocol，最后补恢复、安全和双端一致性。
- 练习：任选五个症状，为每个写出“第一条观察证据、真正事实源、一个不应采用的假修复”，并用源码符号证明判断。

[上一章：测试、构建与发布](15-testing-build-and-release.md) · [相关：总体架构与仓库地图](02-architecture-and-repository-map.md) · [返回总览](README.md) · [下一步：回到第 1 章按最小路径实操](01-project-overview-and-setup.md)
