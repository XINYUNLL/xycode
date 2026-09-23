import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, executeTool } from "./tools.js";
//#step >=3
import { buildSystemPrompt } from "./prompt.js";
//#endstep
//#step >=6
import { checkPermission } from "./permissions.js";
//#endstep
//#step >=7
import { maybeCompact } from "./context.js";
//#endstep
//#step >=8
import { recallMemories } from "./memory.js";
//#endstep
//#step >=11
import { runSubAgent } from "./subagent.js";
//#endstep
//#step >=12
import { connectMcp, type McpConnection } from "./mcp.js";
//#endstep
//#step >=15
import { evaluateGoal, classifyAction } from "./autonomy.js";
//#endstep

const MODEL = process.env.MINI_MODEL || "claude-sonnet-4-5-20250929";

//#step <=2
// A minimal, hard-coded system prompt. Chapter 3 replaces this with a real
// static-core-plus-environment prompt built in prompt.ts.
const SYSTEM_PROMPT =
  "You are Mini Claude Code, a small coding assistant that helps with software " +
  "tasks. Use the tools to read and change files. Keep answers short.";
//#endstep

// The whole agent is one class holding a growing message array and a loop.
export class Agent {
  private client: Anthropic;
  private messages: Anthropic.MessageParam[] = [];
//#step >=10
  mode = "default"; // "plan" makes the agent read-only
//#endstep

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      // Optional: point at an Anthropic-compatible relay via ANTHROPIC_BASE_URL.
      baseURL: process.env.ANTHROPIC_BASE_URL,
    });
  }

  // One user turn. Call the model; if it asks for tools, run them and feed the
  // results back; repeat until it answers with plain text.
//#region loop
  async chat(userText: string): Promise<void> {
    this.messages.push({ role: "user", content: userText });
//#step >=12
    await this.ensureMcp(); // discover external MCP tools before the loop
//#endstep

    while (true) {
//#step >=7
      // Before each model call, compact the history if it has grown too long.
      this.messages = await maybeCompact(this.messages, this.client, MODEL);
//#endstep
//#step >=3
      let system = buildSystemPrompt();
//#step <=2
      let system = SYSTEM_PROMPT;
//#endstep
//#step >=8
      // Recall memories relevant to what the user just asked, into the prompt.
      system += recallMemories(userText);
//#endstep
//#step >=12
      // Merge in any external MCP tools, prefixed so we can route their calls back.
      const mcpTools: Anthropic.Tool[] = (this.mcp?.tools || []).map((t) => ({ name: `mcp__demo__${t.name}`, description: t.description, input_schema: t.input_schema as any }));
      const tools = [...toolDefinitions, ...mcpTools];
//#endstep
      // Build the request once. Passing `tools` is the one line that makes the
      // model tool-aware. Chapter 5 turns the call itself into a stream.
      const request = {
        model: MODEL,
        max_tokens: 4096,
        system,
//#step >=12
        tools,
//#step <=11
        tools: toolDefinitions,
//#endstep
        messages: this.messages,
      };

//#step >=5
      // Stream the reply so text shows up as it is generated, then collect the
      // finished message (same shape a non-streaming call would return).
      const stream = this.client.messages.stream(request);
      stream.on("text", (t) => process.stdout.write(t));
      const reply = await stream.finalMessage();
      process.stdout.write("\n");
//#step <=4
      const reply = await this.client.messages.create(request);
      for (const block of reply.content) {
        if (block.type === "text") process.stdout.write(block.text);
      }
      process.stdout.write("\n");
//#endstep

      // Record the assistant's full reply (text + any tool calls).
      this.messages.push({ role: "assistant", content: reply.content });

      const toolUses = reply.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      // No tool calls means the model is done with this turn.
      if (toolUses.length === 0) return;

      // Run every requested tool and send the outputs back as one user message.
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        console.log(`  → ${tu.name}(${JSON.stringify(tu.input)})`);
//#step >=11
        // The `agent` tool forks a read-only sub-agent with its own context.
        if (tu.name === "agent") {
          const summary = await runSubAgent(String((tu.input as any).task || ""), this.client, MODEL);
          results.push({ type: "tool_result", tool_use_id: tu.id, content: summary });
          continue;
        }
//#endstep
//#step >=12
        // MCP tools (mcp__server__tool) are routed to the MCP server, not run locally.
        if (tu.name.startsWith("mcp__")) {
          // mcp__<server>__<tool> → <tool>; drop the first two "__" segments so a
          // server name with underscores strips the same way Python's does.
          const toolName = tu.name.split("__").slice(2).join("__");
          const output = this.mcp ? await this.mcp.callTool(toolName, tu.input) : "Denied: no MCP server connected.";
          results.push({ type: "tool_result", tool_use_id: tu.id, content: output });
          continue;
        }
//#endstep
//#step >=15
        // Auto mode: a classifier decides block/allow instead of asking a human.
        if (this.mode === "auto" && (tu.name === "write_file" || tu.name === "edit_file" || tu.name === "run_shell")) {
          const verdict = await classifyAction(tu.name, tu.input, this.transcriptText(), this.client, MODEL);
          if (!verdict.allow) {
            results.push({ type: "tool_result", tool_use_id: tu.id, content: `Blocked by auto-mode monitor: ${verdict.reason}` });
            continue;
          }
        }
//#endstep
//#step >=10
        // Plan mode is read-only: writes and shell are denied on top of the gate.
        const blocked = checkPermission(tu.name, tu.input as Record<string, any>) === "deny"
          || (this.mode === "plan" && (tu.name === "write_file" || tu.name === "edit_file" || tu.name === "run_shell"));
        const output = blocked
          ? `Denied: ${tu.name} was blocked (${this.mode} mode).`
          : await executeTool(tu.name, tu.input as Record<string, any>);
//#step >=6
        // Check permission before running the tool; a denied call never runs.
        const output = checkPermission(tu.name, tu.input as Record<string, any>) === "deny"
          ? `Denied: ${tu.name} was blocked by the permission system.`
          : await executeTool(tu.name, tu.input as Record<string, any>);
//#step <=5
        const output = await executeTool(tu.name, tu.input as Record<string, any>);
//#endstep
        results.push({ type: "tool_result", tool_use_id: tu.id, content: output });
      }
      this.messages.push({ role: "user", content: results });
    }
  }
//#endregion
//#step >=4
  // Session support: expose the history so the CLI can save it and restore it.
  history(): Anthropic.MessageParam[] { return this.messages; }
  loadHistory(messages: Anthropic.MessageParam[]): void { this.messages = messages; }
  clearHistory(): void { this.messages = []; }
//#endstep
//#step >=10
  setMode(m: string): void { this.mode = m; }
//#endstep
//#step >=12
  private mcp: McpConnection | null = null;
  // Connect to the MCP server named in MINI_MCP_SERVER once, on first use.
  private async ensureMcp(): Promise<void> {
    if (this.mcp || !process.env.MINI_MCP_SERVER) return;
    this.mcp = await connectMcp("node", [process.env.MINI_MCP_SERVER]);
  }
//#endstep
//#step >=15
  private transcriptText(): string {
    return this.messages.map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : "[tool call / result]"}`).join("\n");
  }
  // Autonomy: keep working until an independent evaluator judges the condition met.
  async pursueGoal(condition: string, prompt: string): Promise<void> {
    await this.chat(prompt);
    for (let i = 0; i < 5; i++) {
      const verdict = await evaluateGoal(condition, this.transcriptText(), this.client, MODEL);
      if (verdict.met) { console.log(`✓ goal met: ${condition}`); return; }
      console.log(`  (goal not met — ${verdict.reason}; continuing)`);
      await this.chat(`The goal "${condition}" is not met yet: ${verdict.reason}. Keep working toward it.`);
    }
    console.log(`  (gave up after 5 iterations without meeting: ${condition})`);
  }
//#endstep
}
