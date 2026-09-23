import Anthropic from "@anthropic-ai/sdk";
import { executeTool, toolDefinitions } from "./tools.js";

// Fork a read-only sub-agent to investigate a task in its own fresh context and
// report back a concise summary — divide and conquer without pouring all the
// intermediate steps into the main conversation. It runs its own little loop,
// in-process, and only the summary comes back.
const EXPLORE_TOOLS = ["read_file", "list_files", "grep_search"];

//#region subagent
export async function runSubAgent(task: string, client: Anthropic, model: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: task }];
  const tools = toolDefinitions.filter((t) => EXPLORE_TOOLS.includes(t.name));

  while (true) {
    const reply = await client.messages.create({
      model, max_tokens: 4096,
      system: "You are an explore sub-agent. Investigate read-only and report back a concise summary.",
      tools, messages,
    });
    messages.push({ role: "assistant", content: reply.content });

    const toolUses = reply.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      return reply.content.filter((b) => b.type === "text").map((b: any) => b.text).join("");
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      // Read-only: a sub-agent can look but not touch.
      const output = EXPLORE_TOOLS.includes(tu.name)
        ? await executeTool(tu.name, tu.input as Record<string, any>)
        : `Denied: the sub-agent is read-only.`;
      results.push({ type: "tool_result", tool_use_id: tu.id, content: output });
    }
    messages.push({ role: "user", content: results });
  }
}
//#endregion
