# Claude Code From Scratch

**Build Claude Code from scratch, step by step**

[![GitHub stars](https://img.shields.io/github/stars/Windy3f3f3f3f/claude-code-from-scratch?style=flat-square&logo=github)](https://github.com/Windy3f3f3f3f/claude-code-from-scratch)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](#)
[![Python](https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white)](#)
[![Lines of Code](https://img.shields.io/badge/~4300_lines-minimal-green?style=flat-square)](#)

> **Want to understand the internals?** Companion project **[How Claude Code Works](https://windy3f3f3f3f.github.io/how-claude-code-works/#/en/)** — 12 deep-dive articles, 330K+ characters, source-level analysis of Claude Code's architecture

---

**Claude Code open-sourced 500K lines of TypeScript. Too much to read?**

This project recreates Claude Code's core architecture in **~4300 lines** (TypeScript and Python implementations) — Agent Loop, 13 tools (with parallel + streaming execution), 4-tier context compression, semantic memory recall, skills, multi-agent, MCP integration — with each step comparing the real source to our simplified version.

This isn't a demo — it's a **step-by-step tutorial**. Follow along, write a few thousand lines of code yourself, and quickly grasp the essence of the best coding agent out there. No need to wade through hundreds of thousands of lines.

## Step-by-Step Tutorial

14 chapters in two phases — first build a working Coding Agent, then add advanced capabilities. Each chapter includes real code + Claude Code source comparison:

| Chapter | Content | Source Mapping |
|---------|---------|---------------|
| **Phase 1: Build a Working Coding Agent** | | |
| [1. Agent Loop](/en/docs/01-agent-loop) | Core loop: call LLM → execute tools → repeat | `agent.ts` ↔ `query.ts` |
| [2. Tool System](/en/docs/02-tools) | 13 tools + mtime guard + deferred loading | `tools.ts` ↔ `Tool.ts` + 66 tools |
| [3. System Prompt](/en/docs/03-system-prompt) | Prompt engineering + @include syntax | `prompt.ts` ↔ `prompts.ts` |
| [4. CLI & Sessions](/en/docs/04-cli-session) | REPL, Ctrl+C, session persistence | `cli.ts` ↔ `cli.tsx` |
| [5. Streaming](/en/docs/05-streaming) | Dual-backend + streaming tool exec + parallel | `agent.ts` ↔ `api/claude.ts` |
| [6. Permissions](/en/docs/06-permissions) | 5 modes + declarative rules + danger detection | `tools.ts` ↔ `permissions/` (52KB) |
| [7. Context](/en/docs/07-context) | 4-tier compression + large result persistence | `agent.ts` ↔ `compact/` |
| **Phase 2: Advanced Capabilities** | | |
| [8. Memory](/en/docs/08-memory) | 4-type memory + semantic recall + async prefetch | `memory.ts` ↔ `memory.ts` |
| [9. Skills](/en/docs/09-skills) | Skill discovery + inline/fork dual mode | `skills.ts` ↔ `SkillTool/` |
| [10. Plan Mode](/en/docs/10-plan-mode) | Read-only planning + 4-option approval workflow | `agent.ts` ↔ `EnterPlanMode` |
| [11. Multi-Agent](/en/docs/11-multi-agent) | Sub-Agent fork-return architecture | `subagent.ts` ↔ `AgentTool/` |
| [12. MCP Integration](/en/docs/12-mcp) | JSON-RPC over stdio for external tools | `mcp.ts` ↔ `mcpClient.ts` |
| **Summary** | | |
| [13. Architecture Comparison](/en/docs/13-whats-next) | Full comparison + extension ideas | Global |
| [14. Testing Guide](/en/docs/14-testing) | 19 manual tests covering all features | `test/` |

## Quick Start

**TypeScript**

```bash
git clone https://github.com/Windy3f3f3f3f/claude-code-from-scratch.git
cd claude-code-from-scratch
npm install && npm run build
```

**Python** (requires Python 3.11+, [details](./python/README.md))

```bash
cd python
pip install -e .
mini-claude-py          # CLI entry (avoids conflict with TS version)
python -m mini_claude   # Or use python -m
```

### API Configuration

Two backends supported, auto-detected via environment variables (custom base URL supported):

**Option 1: Anthropic Format (Recommended)**

```bash
export ANTHROPIC_API_KEY="sk-ant-xxx"
# Optional: use a proxy
export ANTHROPIC_BASE_URL="https://aihubmix.com"
```

**Option 2: OpenAI-Compatible Format**

```bash
export OPENAI_API_KEY="sk-xxx"
export OPENAI_BASE_URL="https://api.openai.com/v1"
```

Default model is `claude-opus-4-6`. Customize via env var or CLI flag:

```bash
export MINI_CLAUDE_MODEL="claude-sonnet-4-6"    # env var
npm start -- --model gpt-4o                      # CLI flag (higher priority)
```

### Run

**TypeScript**

```bash
npm start                    # Interactive REPL mode (recommended)
npm start -- --resume        # Resume last session
npm start -- --yolo          # Skip safety confirmations
npm start -- --plan          # Plan mode: analyze only, no modifications
npm start -- --accept-edits  # Auto-approve file edits
npm start -- --dont-ask      # CI mode: auto-deny confirmable actions
npm start -- --max-cost 0.50 # Cost limit (USD)
npm start -- --max-turns 20  # Turn limit
```

**Python**

```bash
mini-claude-py               # Interactive REPL mode (recommended)
mini-claude-py --resume      # Resume last session
mini-claude-py --yolo        # Skip safety confirmations
mini-claude-py --plan        # Plan mode: analyze only, no modifications
mini-claude-py --accept-edits # Auto-approve file edits
mini-claude-py --dont-ask    # CI mode: auto-deny confirmable actions
mini-claude-py --max-cost 0.50 # Cost limit (USD)
mini-claude-py --max-turns 20  # Turn limit
```

### REPL Commands

| Command | Function |
|---------|----------|
| `/clear` | Clear conversation history |
| `/cost` | Show cumulative token usage and cost |
| `/compact` | Manually trigger conversation compaction |
| `/memory` | List saved memories |
| `/skills` | List available skills |
| `/<skill>` | Invoke a registered skill (e.g. `/commit`) |

## Architecture

```
User Input
  │
  ▼
┌─────────────────────────────────────┐
│          Agent Loop                 │
│                                     │
│  Messages → API (streaming) → Output│
│       ▲                   │         │
│       │              ┌────┴───┐     │
│       │              │  Text  │     │
│       │              │Tool Use│     │
│       │              └────┬───┘     │
│       │                   │         │
│       │   ┌───────┐ ┌────▼───┐     │
│       │   │Truncate│←│Execute │     │
│       │   │ Guard  │ │ Tools  │     │
│       │   └───────┘ └────┬───┘     │
│       │                   │         │
│       │   ┌───────────────▼───┐     │
│       └───│Token Track+Compact│     │
│           └───────────────────┘     │
└─────────────────────────────────────┘
  │
  ▼
Task Done → Auto-save Session
```

## Related Projects

- **[how-claude-code-works](https://github.com/Windy3f3f3f3f/how-claude-code-works)** — Deep dive into Claude Code's architecture (12 articles, 330K+ characters)

## License

MIT
