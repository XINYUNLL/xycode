// Sub-agent system — fork-return pattern with built-in + custom agent types.
// Mirrors Claude Code's AgentTool: explore (read-only), plan (structured), general (full tools),
// plus user-defined agents via .claude/agents/*.md.

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ToolDef } from "./tools.js";
import { toolDefinitions } from "./tools.js";
import { parseFrontmatter } from "./frontmatter.js";

// ─── Types ──────────────────────────────────────────────────

export type SubAgentType = string; // Built-in or custom agent type name

export interface SubAgentConfig {
  systemPrompt: string;
  tools: ToolDef[];
}

interface CustomAgentDef {
  name: string;
  description: string;
  allowedTools?: string[];
  systemPrompt: string;
}

// ─── Read-only tools (for explore and plan agents) ──────────

const READ_ONLY_TOOLS = new Set(["read_file", "list_files", "grep_search"]);

function getReadOnlyTools(): ToolDef[] {
  return toolDefinitions.filter((t) => READ_ONLY_TOOLS.has(t.name));
}

// ─── Built-in agent type prompts ────────────────────────────

const EXPLORE_PROMPT = `You are a file search specialist for xycode. You excel at thoroughly navigating and exploring codebases.

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:
- Creating new files (no write_file, touch, or file creation of any kind)
- Modifying existing files (no edit_file operations)
- Deleting files (no rm or deletion)
- Running ANY commands that change system state

Your role is EXCLUSIVELY to search and analyze existing code.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use list_files for broad file pattern matching
- Use grep_search for searching file contents with regex
- Use read_file when you know the specific file path you need to read
- Adapt your search approach based on the thoroughness level specified by the caller

NOTE: You are meant to be a fast agent that returns output as quickly as possible. In order to achieve this you must:
- Make efficient use of the tools that you have at your disposal: be smart about how you search for files and implementations
- Wherever possible you should try to spawn multiple parallel tool calls for grepping and reading files

Complete the user's search request efficiently and report your findings clearly.`;

const PLAN_PROMPT = `You are a Plan agent — a READ-ONLY sub-agent specialized for designing implementation plans.

IMPORTANT CONSTRAINTS:
- You are READ-ONLY. You only have access to read_file, list_files, and grep_search.
- Do NOT attempt to modify any files.

Your job:
- Analyze the codebase to understand the current architecture
- Design a step-by-step implementation plan
- Identify critical files that need modification
- Consider architectural trade-offs

Return a structured plan with:
1. Summary of current state
2. Step-by-step implementation steps
3. Critical files for implementation
4. Potential risks or considerations`;

const GENERAL_PROMPT = `You are an agent for xycode. Given the user's message, you should use the tools available to complete the task. Complete the task fully—don't gold-plate, but don't leave it half-done. When you complete the task, respond with a concise report covering what was done and any key findings — the caller will relay this to the user, so it only needs the essentials.

Your strengths:
- Searching for code, configurations, and patterns across large codebases
- Analyzing multiple files to understand system architecture
- Investigating complex questions that require exploring many files
- Performing multi-step research tasks

Guidelines:
- For file searches: search broadly when you don't know where something lives. Use read_file when you know the specific file path.
- For analysis: Start broad and narrow down. Use multiple search strategies if the first doesn't yield results.
- Be thorough: Check multiple locations, consider different naming conventions, look for related files.
- NEVER create files unless they're absolutely necessary for achieving your goal. ALWAYS prefer editing an existing file to creating a new one.`;

// ─── Custom agent discovery ─────────────────────────────────

let cachedCustomAgents: Map<string, CustomAgentDef> | null = null;

function discoverCustomAgents(): Map<string, CustomAgentDef> {
  if (cachedCustomAgents) return cachedCustomAgents;

  const agents = new Map<string, CustomAgentDef>();

  // User-level (lower priority)
  loadAgentsFromDir(join(homedir(), ".claude", "agents"), agents);
  // Project-level (higher priority, overwrites)
  loadAgentsFromDir(join(process.cwd(), ".claude", "agents"), agents);

  cachedCustomAgents = agents;
  return agents;
}

function loadAgentsFromDir(dir: string, agents: Map<string, CustomAgentDef>): void {
  if (!existsSync(dir)) return;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const filePath = join(dir, entry);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const { meta, body } = parseFrontmatter(raw);
      const name = meta.name || entry.replace(/\.md$/, "");
      const allowedTools = meta["allowed-tools"]
        ? meta["allowed-tools"].split(",").map((s: string) => s.trim())
        : undefined;
      agents.set(name, {
        name,
        description: meta.description || "",
        allowedTools,
        systemPrompt: body,
      });
    } catch {}
  }
}

// ─── Main config function ───────────────────────────────────

export function getSubAgentConfig(type: SubAgentType): SubAgentConfig {
  // Check custom agents first
  const custom = discoverCustomAgents().get(type);
  if (custom) {
    const tools = custom.allowedTools
      ? toolDefinitions.filter((t) => custom.allowedTools!.includes(t.name))
      : toolDefinitions.filter((t) => t.name !== "agent");
    return { systemPrompt: custom.systemPrompt, tools };
  }

  // Built-in types
  switch (type) {
    case "explore":
      return { systemPrompt: EXPLORE_PROMPT, tools: getReadOnlyTools() };
    case "plan":
      return { systemPrompt: PLAN_PROMPT, tools: getReadOnlyTools() };
    case "general":
    default:
      return {
        systemPrompt: GENERAL_PROMPT,
        tools: toolDefinitions.filter((t) => t.name !== "agent"),
      };
  }
}

// ─── Available agent types (for system prompt) ──────────────

export function getAvailableAgentTypes(): { name: string; description: string }[] {
  const types: { name: string; description: string }[] = [
    { name: "explore", description: "Fast, read-only codebase search and exploration" },
    { name: "plan", description: "Read-only analysis with structured implementation plans" },
    { name: "general", description: "Full tools for independent tasks" },
  ];

  for (const [name, def] of discoverCustomAgents()) {
    types.push({ name, description: def.description });
  }

  return types;
}

export function buildAgentDescriptions(): string {
  const types = getAvailableAgentTypes();
  if (types.length <= 3) return ""; // Only built-in types, already in system prompt

  const custom = types.slice(3);
  const lines = ["\n# Custom Agent Types", ""];
  for (const t of custom) {
    lines.push(`- **${t.name}**: ${t.description}`);
  }
  return lines.join("\n");
}

// Reset cache (for testing)
export function resetAgentCache(): void {
  cachedCustomAgents = null;
}
