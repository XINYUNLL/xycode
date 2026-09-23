import json
import os

import anthropic

from tools import tool_definitions, execute_tool
#step >=3
from prompt import build_system_prompt
#endstep
#step >=6
from permissions import check_permission
#endstep
#step >=7
from context import maybe_compact
#endstep
#step >=8
from memory import recall_memories
#endstep
#step >=11
from subagent import run_sub_agent
#endstep
#step >=12
from mcp_client import connect_mcp
#endstep
#step >=15
from autonomy import evaluate_goal, classify_action
#endstep

MODEL = os.environ.get("MINI_MODEL", "claude-sonnet-4-5-20250929")

#step <=2
# A minimal, hard-coded system prompt. Chapter 3 replaces this with a real
# static-core-plus-environment prompt built in prompt.py.
SYSTEM_PROMPT = (
    "You are Mini Claude Code, a small coding assistant that helps with software "
    "tasks. Use the tools to read and change files. Keep answers short."
)
#endstep


# The whole agent is one class holding a growing message list and a loop.
class Agent:
    def __init__(self) -> None:
        kwargs = {}
        if os.environ.get("ANTHROPIC_API_KEY"):
            kwargs["api_key"] = os.environ["ANTHROPIC_API_KEY"]
        # Optional: point at an Anthropic-compatible relay via ANTHROPIC_BASE_URL.
        if os.environ.get("ANTHROPIC_BASE_URL"):
            kwargs["base_url"] = os.environ["ANTHROPIC_BASE_URL"]
        self.client = anthropic.Anthropic(**kwargs)
        self.messages: list = []
#step >=10
        self.mode = "default"  # "plan" makes the agent read-only
#endstep
#step >=12
        self.mcp = None
#endstep

    # One user turn. Call the model; if it asks for tools, run them and feed the
    # results back; repeat until it answers with plain text.
#region loop
    def chat(self, user_text: str) -> None:
        self.messages.append({"role": "user", "content": user_text})
#step >=12
        self._ensure_mcp()  # discover external MCP tools before the loop
#endstep

        while True:
#step >=7
            # Before each model call, compact the history if it has grown too long.
            self.messages = maybe_compact(self.messages, self.client, MODEL)
#endstep
#step >=3
            system = build_system_prompt()
#step <=2
            system = SYSTEM_PROMPT
#endstep
#step >=8
            # Recall memories relevant to what the user just asked, into the prompt.
            system += recall_memories(user_text)
#endstep
#step >=12
            # Merge in any external MCP tools, prefixed so we can route their calls back.
            mcp_tools = [{"name": f"mcp__demo__{t['name']}", "description": t["description"], "input_schema": t["input_schema"]}
                         for t in (self.mcp.tools if self.mcp else [])]
            tools = tool_definitions + mcp_tools
#step <=11
            tools = tool_definitions
#endstep
            kwargs = dict(model=MODEL, max_tokens=4096, system=system, tools=tools, messages=self.messages)

#step >=5
            # Stream the reply so text shows up as it is generated, then collect
            # the finished message (same shape a non-streaming call would return).
            with self.client.messages.stream(**kwargs) as stream:
                for text in stream.text_stream:
                    print(text, end="", flush=True)
                reply = stream.get_final_message()
            print()
#step <=4
            reply = self.client.messages.create(**kwargs)
            for block in reply.content:
                if block.type == "text":
                    print(block.text, end="", flush=True)
            print()
#endstep

            # Record the assistant's full reply (text + any tool calls).
            self.messages.append({"role": "assistant", "content": reply.content})

            tool_uses = [b for b in reply.content if b.type == "tool_use"]
            # No tool calls means the model is done with this turn.
            if not tool_uses:
                return

            # Run every requested tool; send the outputs back as one user message.
            results = []
            for tu in tool_uses:
                print(f"  → {tu.name}({json.dumps(tu.input)})")
#step >=11
                # The `agent` tool forks a read-only sub-agent with its own context.
                if tu.name == "agent":
                    summary = run_sub_agent(tu.input.get("task", ""), self.client, MODEL)
                    results.append({"type": "tool_result", "tool_use_id": tu.id, "content": summary})
                    continue
#endstep
#step >=12
                # MCP tools (mcp__server__tool) go to the MCP server, not run locally.
                if tu.name.startswith("mcp__"):
                    # mcp__<server>__<tool> -> <tool>; drop the first two "__"
                    # segments so it strips the same way the TypeScript side does.
                    tool_name = "__".join(tu.name.split("__")[2:])
                    output = self.mcp.call_tool(tool_name, tu.input) if self.mcp else "Denied: no MCP server connected."
                    results.append({"type": "tool_result", "tool_use_id": tu.id, "content": output})
                    continue
#endstep
#step >=15
                # Auto mode: a classifier decides block/allow instead of asking a human.
                if self.mode == "auto" and tu.name in ("write_file", "edit_file", "run_shell"):
                    verdict = classify_action(tu.name, tu.input, self._transcript_text(), self.client, MODEL)
                    if not verdict["allow"]:
                        results.append({"type": "tool_result", "tool_use_id": tu.id, "content": f"Blocked by auto-mode monitor: {verdict['reason']}"})
                        continue
#endstep
#step >=10
                # Plan mode is read-only: writes and shell are denied on top of the gate.
                blocked = check_permission(tu.name, tu.input) == "deny" or (
                    self.mode == "plan" and tu.name in ("write_file", "edit_file", "run_shell"))
                output = f"Denied: {tu.name} was blocked ({self.mode} mode)." if blocked \
                    else execute_tool(tu.name, tu.input)
#step >=6
                # Check permission before running the tool; a denied call never runs.
                if check_permission(tu.name, tu.input) == "deny":
                    output = f"Denied: {tu.name} was blocked by the permission system."
                else:
                    output = execute_tool(tu.name, tu.input)
#step <=5
                output = execute_tool(tu.name, tu.input)
#endstep
                results.append({"type": "tool_result", "tool_use_id": tu.id, "content": output})
            self.messages.append({"role": "user", "content": results})
#endregion
#step >=4
    # Session support: expose the history so the CLI can save it and restore it.
    def history(self):
        return self.messages

    def load_history(self, messages) -> None:
        self.messages = messages

    def clear_history(self) -> None:
        self.messages = []
#endstep
#step >=10
    def set_mode(self, m: str) -> None:
        self.mode = m
#endstep
#step >=12
    # Connect to the MCP server named in MINI_MCP_SERVER once, on first use.
    def _ensure_mcp(self):
        if self.mcp is None and os.environ.get("MINI_MCP_SERVER"):
            self.mcp = connect_mcp("node", [os.environ["MINI_MCP_SERVER"]])
#endstep
#step >=15
    def _transcript_text(self):
        return "\n".join(
            f"{m['role']}: {m['content'] if isinstance(m.get('content'), str) else '[tool call / result]'}"
            for m in self.messages)

    # Autonomy: keep working until an independent evaluator judges the condition met.
    def pursue_goal(self, condition, prompt):
        self.chat(prompt)
        for _ in range(5):
            verdict = evaluate_goal(condition, self._transcript_text(), self.client, MODEL)
            if verdict["met"]:
                print(f"✓ goal met: {condition}")
                return
            print(f"  (goal not met — {verdict['reason']}; continuing)")
            self.chat(f'The goal "{condition}" is not met yet: {verdict["reason"]}. Keep working toward it.')
        print(f"  (gave up after 5 iterations without meeting: {condition})")
#endstep
