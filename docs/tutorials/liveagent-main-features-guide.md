# LiveAgent 主要功能与源码学习指南

## 1. 导读

### 1.1 这份教程适合谁

本文面向第一次接触 LiveAgent 的开发者。你不需要预先理解 Agent Runtime、MCP、长期记忆或上下文压缩，但应具备基础编程知识，并能阅读 TypeScript、Rust 和 Go 项目的目录结构。

### 1.2 学完后你应该能做什么

完成本教程后，你应该能够：

1. 说明桌面 GUI、Tauri/Rust、Go Gateway 和 Browser WebUI 的职责与权限边界。
2. 从用户发送消息开始，追踪一次 Agent 请求直到历史保存和记忆提取完成。
3. 区分 Chat Runtime、Tools、Skills、MCP、Memory、History Compaction 的作用。
4. 根据功能现象找到主要源码入口，并判断问题属于前端运行时、Rust 服务还是 Gateway。
5. 在修改功能前列出影响面，在功能异常时按照证据逐层排查。

### 1.3 贯穿全文的统一案例

后续章节都围绕同一个请求展开：

> 用户要求 Agent 读取项目中的一个文件，修改代码，并记住一条项目约定。

这个案例同时涉及上下文构造、文件工具、工具循环、历史持久化、Memory 提取，以及长对话中的上下文压缩，因此适合观察各模块如何协作。

### 1.4 推荐学习顺序

1. 先阅读“总体架构”，建立进程与权限边界。
2. 再阅读“一次请求的完整生命周期”，理解主干流程。
3. 依次深入 Chat Runtime、Tools、Skills/MCP、Memory、History Compaction。
4. 最后按源码路线阅读代码，并完成练习与排障案例。

### 1.5 术语速查

| 术语 | 含义 |
|---|---|
| GUI | Tauri WebView 中运行的 React 桌面界面，也是 Chat Runtime 的主要承载端。 |
| Tauri | 桌面应用的 Rust 后端，提供文件、进程、SQLite、Memory、MCP 等本地高权限能力。 |
| Gateway | Go 编写的远程中继服务，负责认证、连接、命令转发、事件广播和有界缓冲。 |
| WebUI | 浏览器远程操作界面，通过 Gateway 使用桌面端 Agent，不直接获得本地系统权限。 |
| Turn | 一次模型处理轮次；一个用户请求可能因工具调用包含多个模型轮次。 |
| Tool Loop | 模型提出工具调用、应用执行工具、结果回填模型、模型继续推理的循环。 |
| Skill | 注入给模型的工作方法、领域知识或操作说明。 |
| MCP | Model Context Protocol，用于把外部工具服务动态接入 Agent。 |
| Memory | 跨轮次或跨会话保留的用户偏好、反馈和项目知识。 |
| History Segment | 持久化对话历史的分段单元。 |
| Checkpoint | 压缩旧上下文后产生的摘要检查点。 |
| FTS | Full-Text Search，SQLite 全文搜索索引。 |

## 2. 总体架构：谁负责什么

## 3. 一次 Agent 请求的完整生命周期

## 4. Chat Runtime：如何组织一次对话

## 5. Tools：模型如何执行真实操作

## 6. Skills 与 MCP：方法知识和外部能力如何接入

## 7. Memory：系统如何跨对话记住信息

## 8. History 与 Context Compaction：长对话如何保存和续接

## 9. 五个系统如何协作

## 10. 源码阅读路线

## 11. 动手练习

## 12. 常见故障排查

## 13. 功能修改检查表

## 14. 后续阅读与总结
