# xycode

一个从零复刻 Claude Code 内核的 coding agent。

基于 [claude-code-from-scratch](https://github.com/Windy3f3f3f3f/claude-code-from-scratch)（MIT License）二次开发：在读懂内核的基础上，加入自己的原创特性，并用数据验证它们的价值。

> ⚖️ 声明：本项目是学习 / 二次开发项目，"Claude Code" 是 Anthropic 的商标，本项目与 Anthropic 无关联。

## 定位

不是「又一个 Claude Code 克隆」，而是三件事：

1. **搞懂内核** —— 从零实现 agent loop、流式输出、上下文压缩、工具调用、权限、子 agent、MCP；
2. **加自己的东西** —— 加入原版没有的原创特性；
3. **用数据验证** —— 用自建 eval 量化每个改动的价值。

## 它能做什么

- **Agentic loop**：模型「点菜」（要工具），循环「做菜」（执行工具并回喂结果）
- **工具**：读 / 写 / 编辑文件、列目录、grep 搜索、执行 shell、调用子 agent、MCP 工具等
- **流式输出** + **并行工具执行** + **prompt 缓存**
- **4 层上下文压缩**：budget → snip → microcompact → auto-compact
- **多种权限模式**：默认逐条确认 / `--yolo` / `--plan` / `--accept-edits` / `--dont-ask` / `--auto`
- **子 agent、MCP、记忆、skills、`/goal` 自主模式**
- **多 provider**：Anthropic 格式 + OpenAI 兼容格式

## 相对原版的改动

### 新增

- **`.env` 自动加载**：启动时自动读 `.env`（先查当前目录，再查程序所在目录），且不覆盖已设置的环境变量。原版的 `.env.example` 形同虚设——编译出来的 CLI 根本不读它。
- **GitHub 发布 MCP**：新增 `create_repo` / `push_current_repo` 两个 MCP 工具（`mcp/github-server.mjs`，裸 JSON-RPC 实现、零依赖），让 agent 能一键建仓库、推送项目到 GitHub。
- **跨会话记忆 MCP**：新增 `add_note` / `list_notes` 两个 MCP 工具（`mcp/memory-server.mjs`，裸 JSON-RPC、零依赖），让 agent 能跨会话记住用户偏好、结论和待办。

### 修复（Windows 兼容）

- **教程 runner 崩溃**（`steps/run.mjs`）：原版用 `spawnSync(node_modules/.bin/tsc)` 调编译器，Windows 的 Node(≥20) 因 CVE-2024-27980 拒绝 spawn 无 `.exe` 的 shell 脚本，报错打印 `NaN`。改为直接调用 `typescript/lib/tsc.js`。
- **mock server 退出断言崩溃**：undici 流式连接 + `process.exit(0)` 触发 libuv `UV_HANDLE_CLOSING` 断言。加 `Connection: close` + `closeAllConnections` + 自然退出。

### Roadmap

- [ ] Critic 评审模式：主 agent 改完自动送审，用 eval 量化质量提升
- [ ] 自建 eval harness 接入

## 快速开始

```bash
# 1. 安装依赖并编译
npm install
npm run build

# 2. 在项目根目录建 .env（已被 .gitignore 忽略）
#    ANTHROPIC_API_KEY=你的key
#    ANTHROPIC_BASE_URL=你的代理地址   # 若走中转，必填
#    XYCODE_MODEL=claude-sonnet-5       # 可选，覆盖默认模型
#    GITHUB_TOKEN=你的token             # 可选，启用 GitHub 发布 MCP（需 repo 权限）

# 3. 注册全局命令（可选，之后任何目录都能敲 xycode）
npm link

# 4. 跑起来
xycode "看看这个目录是什么项目"   # 一次性任务
xycode                            # 交互式 REPL
```

## 用法

**权限模式**：默认逐条确认；`--yolo` 全自动；`--plan` 只读；`--accept-edits` 自动放行编辑；`--auto` 用 LLM 判断每个动作。

**REPL 命令**：`/clear` 清历史 · `/plan` 切只读 · `/cost` 看成本 · `/compact` 手动压缩 · `/goal` 自主追目标 · `/memory` 看记忆 · `/skills` 看技能 · `/<技能名>` 调用技能。

完整参数见 `xycode --help`。

## 致谢

本项目基于 [Windy3f3f3f3f/claude-code-from-scratch](https://github.com/Windy3f3f3f3f/claude-code-from-scratch)，其 13 章分步教程完整保留在 [`docs/`](./docs) 目录，每一章都能一条命令跑起来、无需 API key。

## License

[MIT](./LICENSE)
