# Mini Claude 功能测试指南

手动测试 19 项功能。全部使用 `--yolo` 模式。TS 和 Python 各测一遍。

## 准备

```bash
cd claude-code-from-scratch

# 一键配置测试环境（MCP、Skills、CLAUDE.md、大文件）
bash test/setup.sh

# 构建 TS 版
npm run build # 如果使用ts版则需构建，python版不用
```

确保 `.env` 已配置好 API Key：
```
ANTHROPIC_API_KEY=sk-xxx
ANTHROPIC_BASE_URL=https://aihubmix.com   # 可选
```

> **提示**：如果系统环境里同时有 `OPENAI_API_KEY` + `OPENAI_BASE_URL` 和 `ANTHROPIC_API_KEY`，
> 会优先走 OpenAI 兼容路径。两种路径都支持全部功能（包括语义记忆召回）。

---

## 启动方式

**TS 版（二选一）**：
```bash
# 交互式 REPL（推荐，能测 skill 和 REPL 命令）
node dist/cli.js --yolo

# one-shot 模式
node dist/cli.js --yolo "你的提示词"
```

**Python 版**：
```bash
python -m mini_claude --yolo

# 或 one-shot
python -m mini_claude --yolo "你的提示词"
```

---

## 测试项目

### 1. MCP 工具调用

**预期**：启动时看到 `[mcp] Connected to 'test' — 3 tools`

在 REPL 中输入：
```
Use the MCP 'add' tool to compute 17+25, then use the 'echo' tool to echo "hello MCP", then use the 'timestamp' tool.
```

✅ 预期输出：
- add 返回 `42`
- echo 返回 `hello MCP`
- timestamp 返回一个 Unix 时间戳
- 工具名带 `mcp__test__` 前缀

---

### 2. WebFetch

```
Fetch the URL https://httpbin.org/json and tell me the slideshow title.
```

✅ 预期：返回 `Sample Slide Show`

```
Fetch https://example.com and tell me what the page is about.
```

✅ 预期：返回 HTML 转换后的纯文本内容

---

### 3. 并行工具执行

```
Read the files src/frontmatter.ts, src/session.ts, and src/skills.ts at the same time, then tell me each file's line count.
```

✅ 预期：三个 `read_file` 调用同时出现（不是一个一个来的）

Python 版：
```
Read the files python/mini_claude/frontmatter.py and python/mini_claude/session.py at the same time, then tell me each file's line count.
```

---

### 4. 语义记忆召回

**第一步：保存记忆**
```
Save these memories for me:
1. type=project, name="API migration", description="Moving from REST to GraphQL", content="We are migrating our API from REST to GraphQL. Deadline is end of Q2 2025."
2. type=feedback, name="code style", description="Prefers functional programming", content="User prefers functional patterns (map/filter/reduce) over for loops and OOP."
3. type=reference, name="staging server", description="Staging environment URL", content="Staging server: https://staging.example.com, credentials in 1Password."
```

✅ 预期：三个 memory 文件被写入

**第二步：退出，重新启动一个新的对话**，然后输入会触发工具调用的查询（语义相关但不含关键词）：

> **原理**：语义召回是异步 prefetch（和 Claude Code 行为一致，zero-wait 不阻塞）。
> prefetch 在用户消息发出时启动，需要几秒完成。如果模型直接文本回答不调工具，
> 循环只跑一次就结束了，prefetch 来不及被消费。所以测试查询需要能触发工具调用，
> 给 prefetch 足够时间在第二轮 iteration 被注入。

```
Read the file tsconfig.json, then tell me: where can I deploy to test my changes?
```
✅ 预期：模型先读取 tsconfig.json（给 prefetch 时间 settle），然后召回 staging server 记忆，回答 `https://staging.example.com`

```
List the files in the src/ directory, then tell me: what's the deadline for the backend rewrite?
```
✅ 预期：模型先列出文件，然后召回 API migration 记忆，回答 `end of Q2 2025`

```
Read package.json, then tell me: how should I write code for this project? What patterns does our team prefer?
```
✅ 预期：模型先读取文件，然后召回 code style 记忆，提到 functional programming

---

### 5. @include 指令 + Rules 自动加载

setup.sh 已经创建了：
- `CLAUDE.md` 包含 `@./.claude/rules/chinese-greeting.md`
- rule 内容：`When the user greets you, respond in Chinese`

```
Hello! Who are you?
```

✅ 预期：模型用**中文**回复（因为 rule 要求打招呼时说中文）

---

### 6. Read-before-edit 保护

```
Edit the file package.json and change the version to "9.9.9". Do NOT read it first.
```

✅ 预期（两种可能都算通过）：
- **最佳**：工具层直接返回 `Error: You must read this file before editing`
- **次佳**：模型因为 system prompt 的要求，自动先 read 再 edit（说明 prompt 层 guard 生效）

测完记得恢复：
```
Now change it back to "1.0.0".
```

---

### 7. 大结果持久化

```
Read the file test/large-file.txt
```

✅ 预期输出包含：
- `[Result too large (XX.X KB, 1000 lines). Full output saved to /home/.../.mini-claude/tool-results/xxx-read_file.txt]`
- `Preview (first 200 lines):`
- 只显示前 200 行的预览

然后继续问：
```
What does line 500 say?
```

✅ 预期：模型用 grep_search 或 read_file 从持久化文件/原文件找到 Line 499 的内容

---

### 8. Skill 调用

在 REPL 中输入：
```
/skills
```
✅ 预期：列出 greet 和 commit 两个 skill

```
/greet Alice
```
✅ 预期：模型生成一段对 Alice 的个性化问候

```
/commit
```
✅ 预期：模型执行 git diff/status，然后尝试创建 commit（可能因为没有 staged files 而提示先 stage）

---

### 9. ToolSearch / 延迟加载工具

```
Use tool_search to find the "plan mode" tool.
```

✅ 预期：
- 模型调用 `tool_search`
- 返回 `enter_plan_mode` 和/或 `exit_plan_mode` 的完整 schema
- 这些工具之前不在工具列表中，被搜索后才激活

---

### 10. REPL 命令

在 REPL 中依次测试：

```
/cost
```
✅ 显示 token 用量和费用

```
/memory
```
✅ 列出已保存的记忆（如果测了第 4 步的话）

```
/compact
```
✅ 手动触发对话压缩

```
/plan
```
✅ 切换到 plan mode（再输入一次切回来）

---

### 11. Sub-agent 系统（Agent Tool）

测试 agent 工具的三种内置类型：explore（只读搜索）、plan（结构化规划）、general（完整工具）。

**explore agent**：
```
Use the agent tool with type "explore" to find all files that import from "./memory.js" in the src/ directory.
```

✅ 预期：
- 输出显示 `[sub-agent:explore]` 标记
- 返回引用 `memory.js` 的文件列表
- 只使用 read_file / list_files / grep_search（不会修改文件）

**plan agent**：
```
Use the agent tool with type "plan" to design a plan for adding a "help" REPL command. Identify which files need modification.
```

✅ 预期：输出显示 `[sub-agent:plan]` 标记，返回结构化修改计划

**general agent**：
```
Use the agent tool with type "general" to create a file called /tmp/mini-claude-agent-test.txt with the content "agent test passed", then read it back.
```

✅ 预期：
- 输出显示 `[sub-agent:general]` 标记
- 成功创建并读取文件，内容为 `agent test passed`
- sub-agent 的 token 消耗累加到主 agent（`/cost` 可见）

---

### 12. Plan Mode（手动进入）

在 `--yolo` REPL 中手动切换 plan mode，测试只读限制 + plan file + 审批流程。

**第一步：进入 plan mode**
```
/plan
```

✅ 预期：显示 plan mode 已开启

**第二步：测试只读限制**
```
Read package.json, then create a plan for changing the project name. Write your plan to the plan file.
```

✅ 预期：
- 模型能读取 package.json（read 工具允许）
- 模型写入 plan file（唯一允许编辑的文件）
- 如果尝试直接编辑 package.json，会被拒绝：`Blocked in plan mode`

**第三步：审批流程**

等模型调用 `exit_plan_mode` 后，出现 4 个选项：
1. 选择 `4`（keep-planning），输入反馈："Also add a step for updating README"
2. 模型修改计划后再次 exit_plan_mode，选择 `1`（clear-and-execute）

✅ 预期：选择 1 后上下文清理，切换到执行模式

**第四步：退出 plan mode**
```
/plan
```
✅ 预期：切换回普通模式

---

### 13. Edit 的引号规范化（Curly Quotes）

测试 edit_file 的 old_string 使用弯引号（curly quotes）时，自动匹配文件中的直引号。

先读取测试文件：
```
Read the file test/quote-test.js
```

然后要求使用弯引号编辑（关键：让模型在 old_string 中使用 Unicode 弯引号）：
```
Use edit_file on test/quote-test.js. In the old_string, use curly double quotes (Unicode U+201C and U+201D) around "Hello World". Replace with straight quotes saying "Hi Universe".
```

✅ 预期：
- 编辑成功，输出包含 `(matched via quote normalization)`
- 文件内容从 `"Hello World"` 变为 `"Hi Universe"`

测完恢复：
```
Edit test/quote-test.js, replace "Hi Universe" with "Hello World"
```

---

### 14. Session Resume（--resume）

测试 `--resume` 恢复上一次会话的消息历史。

**第一次会话**：
```bash
node dist/cli.js --yolo
```
```
Remember this: The secret code is BANANA-42. Read package.json and tell me the version.
```
记下回答，然后输入 `exit` 退出。

**第二次会话（恢复）**：
```bash
node dist/cli.js --yolo --resume
```

✅ 预期：启动时显示 session restored 信息

```
What was the secret code I told you earlier?
```

✅ 预期：模型回答 `BANANA-42`（从恢复的历史中获取）

**对比（不 resume 的新会话）**：
```bash
node dist/cli.js --yolo
```
```
What was the secret code I told you earlier?
```
✅ 预期：模型无法回答（新对话，无历史）

---

### 15. One-shot 模式

直接传入 prompt 参数，执行完毕后自动退出（不进入 REPL）。

```bash
node dist/cli.js --yolo "Read the file package.json and tell me the project name. Only output the name."
```

✅ 预期：
- 模型调用 read_file，输出项目名称
- 程序执行完毕后**自动退出**（返回 shell prompt），不进入交互模式

```bash
node dist/cli.js --yolo "List all TypeScript files in the src/ directory"
```

✅ 预期：调用 list_files，输出 .ts 文件列表，然后自动退出

测试错误场景：
```bash
node dist/cli.js --yolo "Read the file /nonexistent/path/file.txt"
```
✅ 预期：即使工具返回错误，程序仍正常退出（不 crash）

---

### 16. 预算控制（--max-turns）

测试 `--max-turns` 限制 agent 循环次数。

```bash
node dist/cli.js --yolo --max-turns 2 "Read these files one by one: package.json, tsconfig.json, src/cli.ts, src/agent.ts, src/tools.ts. Tell me the line count of each."
```

✅ 预期：
- 模型开始读取文件，但在 2 个 agentic turn 之后停止
- 输出包含预算超限提示（如 `Budget exceeded` 或 `Turn limit`）
- 模型**不会**读完所有 5 个文件
- 程序正常退出

---

### 17. Grep Search 工具

测试 grep_search 的正则搜索 + include 过滤。

```
Use grep_search to find all lines containing "import.*chalk" in the src/ directory
```

✅ 预期：返回 `src/agent.ts` 和/或 `src/ui.ts` 中的匹配行，格式为 `文件路径:行号:匹配内容`

```
Use grep_search to find the pattern "export function" in all .ts files under src/
```

✅ 预期：使用 `include: "*.ts"` 过滤，返回所有导出函数的位置

```
Use grep_search to find "DANGEROUS_PATTERNS" in the project
```

✅ 预期：返回 `src/tools.ts` 中的定义位置

---

### 18. Write File（新文件 + 自动建目录）

测试 write_file 创建新文件并自动创建不存在的目录。

```
Create a new file at test/tmp/nested/hello.txt with the content:
Line 1: Hello from Mini Claude
Line 2: This is a write test
Line 3: End of file
```

✅ 预期：
- 目录 `test/tmp/nested/` 自动创建（之前不存在）
- 返回 `Successfully wrote to test/tmp/nested/hello.txt (3 lines)` 和行号预览

```
Read the file test/tmp/nested/hello.txt to verify.
```

✅ 预期：内容完整

然后测试长文件预览截断：
```
Create a file test/tmp/long-file.txt with 50 numbered lines like "Line 1: test data", "Line 2: test data", etc.
```

✅ 预期：预览只显示前 30 行，末尾显示 `... (50 lines total)`

测完清理：`rm -rf test/tmp`

---

### 19. 自定义 Agent（.claude/agents/）

测试用户在 `.claude/agents/` 下定义自定义 agent 类型。

先确认自定义 agent 可见：
```
What agent types are available? List them all.
```

✅ 预期：列表中包含 explore、plan、general 和 **reviewer**（自定义）

使用自定义 agent：
```
Use the agent tool with type "reviewer" to review the file src/frontmatter.ts
```

✅ 预期：
- 输出显示 `[sub-agent:reviewer]` 标记
- reviewer 只使用 read_file / list_files / grep_search（受 allowed-tools 限制）
- 返回代码审查结果

---

## 测试完成

```bash
bash test/cleanup.sh
```

清理所有测试产生的文件（MCP 配置、skills、rules、记忆文件等）。

---

## 快速对照表

| # | 功能 | TS 通过 | PY 通过 | 备注 |
|---|------|:---:|:---:|------|
| 1 | MCP 工具调用 | ☐ | ☐ | 3 个工具 |
| 2 | WebFetch | ☐ | ☐ | httpbin.org |
| 3 | 并行工具执行 | ☐ | ☐ | 多文件同时读 |
| 4 | 语义记忆召回 | ☐ | ☐ | 保存→新对话→语义查询 |
| 5 | @include + Rules | ☐ | ☐ | 中文回复 |
| 6 | Read-before-edit | ☐ | ☐ | 代码层或 prompt 层 |
| 7 | 大结果持久化 | ☐ | ☐ | 75KB 文件 |
| 8 | Skill 调用 | ☐ | ☐ | /greet /commit |
| 9 | ToolSearch | ☐ | ☐ | plan mode 工具 |
| 10 | REPL 命令 | ☐ | ☐ | /cost /memory /compact /plan |
| 11 | Sub-agent 系统 | ☐ | ☐ | explore/plan/general 三类型 |
| 12 | Plan Mode | ☐ | ☐ | /plan 手动进入 + 审批流程 |
| 13 | 引号规范化 | ☐ | ☐ | curly → straight quotes |
| 14 | Session Resume | ☐ | ☐ | --resume 恢复会话 |
| 15 | One-shot 模式 | ☐ | ☐ | 传 prompt 自动退出 |
| 16 | 预算控制 | ☐ | ☐ | --max-turns 限制 |
| 17 | Grep Search | ☐ | ☐ | 正则搜索 + include |
| 18 | Write File | ☐ | ☐ | 新文件 + 自动建目录 |
| 19 | 自定义 Agent | ☐ | ☐ | .claude/agents/ 定义 |
