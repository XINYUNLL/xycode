# xycode 架构说明

> 基于 claude-code-from-scratch 二次开发的 coding agent。本文档讲清「它内部是怎么转的」——面向想读懂这个项目的人（评审者 / 面试官 / 未来的自己）。

---

## 1. 一句话总览

xycode 是一个 **agentic loop**：模型（LLM）负责「点菜」（决定要调用哪个工具），循环负责「做菜」（执行工具、把结果回喂给模型），如此往复直到模型输出最终答案。

```
                    ┌─────────────────────────────────────────┐
                    │              Agentic Loop               │
  用户输入 ──────▶  │  预算检查 → 压缩检查 → 调 LLM（流式）   │
                    │     │                                    │
                    │     ▼                                    │
                    │  模型返回 tool_use？                     │
                    │   ├─ 是 → 执行工具 → 结果回喂 → 回到循环  │
                    │   └─ 否 → 最终回答，退出                  │
                    └─────────────────────────────────────────┘
                           │                      ▲
                           ▼                      │
                  ┌────────────────┐   ┌─────────────────────┐
                  │ 工具层（12 核心）│   │ 子 agent / MCP / 记忆│
                  │ 读/写/改/搜/shell│   │ （并行探索/评审/MCP） │
                  └────────────────┘   └─────────────────────┘
```

---

## 2. Agentic Loop（核心）

实现在 `src/agent.ts`，有 Anthropic / OpenAI 两条后端（`chatAnthropic` / `chatOpenAI`），结构对称。

每轮循环四步：

1. **预算检查**：`checkBudget()` 检查 `max-turns`（轮数上限）和 `max-cost`（美元预算）。超限时对每个未执行的 `tool_use` 回喂一条 `tool_result`（"Tool call not executed"），保证消息序列合法（否则 API 报 400）。
2. **压缩检查**：`runCompressionPipeline()` 跑 4 层压缩（见 §4）。
3. **调 LLM**：流式发送「对话历史 + 工具定义」，边收边处理。**并行工具执行**：流式期间，`CONCURRENCY_SAFE_TOOLS`（read_file / list_files / grep_search / web_fetch）会提前启动，模型还没说完工具就在跑了。
4. **看返回**：模型返回 `tool_use` → 逐个执行、结果作为 `tool_result` 回喂；返回纯文本 → 结束。

**上下文预算**：`effectiveWindow = getContextWindow(model) - 20000`，留出 2 万 token 给输出。

---

## 3. 工具系统（`src/tools.ts`）

**12 个核心工具**：

| 工具 | 作用 |
|---|---|
| read_file | 读文件（支持 `offset`/`limit` 读大文件指定行段） |
| write_file / edit_file | 写 / 改文件 |
| list_files | 列目录（glob 匹配） |
| grep_search | 正则搜代码 |
| run_shell | 执行 shell |
| skill | 调用技能 |
| web_fetch | 抓取网页 |
| enter_plan_mode / exit_plan_mode | 进出 plan 模式 |
| agent | 派发单个子 agent |
| tool_search | 搜索工具 |

**主 agent 额外追加**（`src/agent.ts` 构造函数）：

- `parallel_explore`（始终有）：并行探索子 agent（见 §5）。
- `undo_edit` / `todo_write`（受 `--baseline` 开关控制，用于 A/B）。

**工具分发**：`executeToolCall(name, input)` 是统一入口——先匹配内置特殊工具（undo/todo/parallel_explore/plan/agent/skill），再匹配 MCP 工具，最后落到 `executeTool()`。

---

## 4. 上下文压缩（4 层）

面对超长对话，按「零 API 成本 → 高成本」的顺序逐层压缩（`src/agent.ts`）：

| 层 | 机制 | 成本 |
|---|---|---|
| **budget** | 单个 tool_result 超 15k（利用率>0.7）或 30k 字符就截断，保留头尾 | 0 |
| **snip** | 过期/重复的 tool_result 替换成 `[Content snipped - re-read if needed]` 占位 | 0 |
| **microcompact** | 更细的轻量压缩 | 0 |
| **auto-compact** | 把历史摘要成一段，重置为 `[摘要, "Understood…"]`，保留最后一条 user 消息 | 1 次 LLM 调用 |

**关键不变量**：压缩时最后一条消息必须是纯 user 文本——否则 `tool_use` / `tool_result` 配对被切断，下一轮 API 直接 400。

---

## 5. 子 agent（`src/subagent.ts` + `src/agent.ts`）

fork-return 模式：fork 一个隔离的子 agent 跑完任务，把结果返回给主 agent。

**内置类型**：

| 类型 | 工具 | 用途 |
|---|---|---|
| explore | 只读（read_file / list_files / grep_search） | 快速搜代码 |
| plan | 只读 | 产出结构化实现计划 |
| general | 全工具（除 agent） | 独立完成子任务 |

**两个扩展**：

- **Critic 自审**（`runCritic`）：fork 只读评审子 agent 审 `git diff`，回复 `APPROVED` 才通过，否则把问题回喂主 agent 继续修。
- **parallel_explore**（`parallelExplore`）：把一个探索问题拆成若干子问题，`Promise.all` fork N 个只读 explore 子 agent **并行**查，合并成带 `file:line` 的摘要。上限 6 个子问题。

**自定义 agent**：读 `.claude/agents/*.md`（frontmatter 声明 name / description / allowed-tools）。

---

## 6. 记忆系统（`src/memory.ts`）

**存储**：

- 位置 `~/.xycode/projects/{sha256(cwd)前16位}/memory/`——按项目 cwd 哈希隔离。
- 文件 `{type}_{slugified_name}.md`，4 类：`user` / `feedback` / `project` / `reference`。
- `MEMORY.md` 索引自动生成（截断 200 行 / 25KB）。

**召回（混合策略）**：

1. **Embedding 语义召回**（优先）：query 转向量（本地 bge-small-zh-v1.5，`embed.py`），余弦相似度（归一化后=点积），取 top-5 且分数 > 0.35。
2. **模型 sideQuery**（回退）：读每个记忆的前 30 行 frontmatter，让模型返回 JSON 选最多 5 个文件名。

**预取门控**：问题够实质（2+ 中文字符或含空白）、会话记忆预算 < 60KB、记忆目录非空。

**向量存储**：`embeddings.json` 存 `{filename: [512 维向量]}`，写入记忆时顺便计算。

---

## 7. MCP（`src/mcp.ts`）

解决「工具集成 N×M 爆炸」→ N+M。裸 JSON-RPC 2.0 over stdio，**零依赖**（不引 MCP SDK）。

- 三角色 Host / Client / Server；启动时 `tools/list` 动态发现。
- 工具名带命名空间，避免冲突。
- 自带两个 server：GitHub 发布（`create_repo` / `push_current_repo`）、跨会话记忆（`add_note` / `list_notes`）。

---

## 8. 权限模式（`src/tools.ts`）

6 种：`default`（逐条确认）/ `plan`（只读）/ `acceptEdits`（自动放行编辑）/ `bypassPermissions`（全自动）/ `dontAsk`（自动拒绝）/ `auto`（LLM 分类器逐动作判断）。

子 agent 用 `childPermissionMode()` 继承或降级；只读子 agent 直接 `bypassPermissions` + 只读工具集（本质上没有可越权的东西）。

---

## 9. Prompt 缓存

system prompt 拆成两半：

- **静态**（可缓存，放 cache_control 断点）：对所有会话相同。
- **动态**（不缓存）：env / git / memory / CLAUDE.md。

token 分账：`cache_read`（命中，0.1x 计费）/ `cache_creation`（写入，1.25x）/ `input`（未缓存，1x）。

---

## 10. 自我纠错链（8 个原创特性）

「读 → 改 → 测 → 审」的闭环，全部受 `--baseline` 开关控制（一键关掉做 A/B）：

1. **read-before-write**：edit_file 拦截未读过的文件。
2. **自动验证回路**：写文件标记「未验证」，跑测试命令清除；模型停下时若还脏着，注入 VERIFY_PROMPT 催它跑测试。
3. **Critic 自审回路**：改完 + 验证后，fork 只读子 agent 审 diff。
4. **undo**：写/改前记录旧内容，`undo_edit` 撤销最近一次编辑。
5. **read_file offset/limit**：读大文件指定行段。
6. **embedding 语义记忆**：本地向量召回。
7. **TodoWrite**：任务打勾清单。
8. **parallel_explore**：并行探索子 agent。

---

## 11. 评测体系

| 层 | 说明 |
|---|---|
| 自建 harness（16 题） | Node 布尔表达式 + 隐藏测试脚本判卷，不靠 LLM 当裁判 |
| SWE-bench | 真实 GitHub issue，官方 harness（Windows 上修了 3 个跨平台 bug） |
| A/B 消融 | `--baseline` 一键关自我纠错，量化特性价值 |

**方法论**：pilot（n=5-9）→ 正式（n=40 分层抽样 + 固定种子，`sample_manifest.json` 记录抽样凭证）。
