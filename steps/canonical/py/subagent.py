from tools import tool_definitions, execute_tool

# Fork a read-only sub-agent to investigate a task in its own fresh context and
# report back a concise summary — divide and conquer without pouring all the
# intermediate steps into the main conversation. It runs its own little loop,
# in-process, and only the summary comes back.
EXPLORE_TOOLS = ["read_file", "list_files", "grep_search"]


#region subagent
def run_sub_agent(task, client, model):
    messages = [{"role": "user", "content": task}]
    tools = [t for t in tool_definitions if t["name"] in EXPLORE_TOOLS]

    while True:
        reply = client.messages.create(
            model=model, max_tokens=4096,
            system="You are an explore sub-agent. Investigate read-only and report back a concise summary.",
            tools=tools, messages=messages,
        )
        messages.append({"role": "assistant", "content": reply.content})

        tool_uses = [b for b in reply.content if b.type == "tool_use"]
        if not tool_uses:
            return "".join(b.text for b in reply.content if b.type == "text")
        results = []
        for tu in tool_uses:
            # Read-only: a sub-agent can look but not touch.
            output = execute_tool(tu.name, tu.input) if tu.name in EXPLORE_TOOLS \
                else "Denied: the sub-agent is read-only."
            results.append({"type": "tool_result", "tool_use_id": tu.id, "content": output})
        messages.append({"role": "user", "content": results})
#endregion
