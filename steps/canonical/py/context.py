# When the conversation gets long, summarize the older messages into one so the
# context window doesn't overflow. Real agents count tokens; we count messages,
# which is enough to see the mechanism work.
COMPACT_THRESHOLD = 6
KEEP_RECENT = 2


#region compact
def maybe_compact(messages, client, model):
    if len(messages) <= COMPACT_THRESHOLD:
        return messages

    older = messages[: len(messages) - KEEP_RECENT]
    recent = messages[len(messages) - KEEP_RECENT :]

    # One aux model call: summarize the older messages (rendered as plain text so
    # we never split a tool_use / tool_result pair).
    transcript = "\n".join(
        f"{m['role']}: {m['content'] if isinstance(m.get('content'), str) else '[tool call / result]'}"
        for m in older
    )
    reply = client.messages.create(
        model=model, max_tokens=1024,
        system="Summarize the conversation so far in a few sentences, keeping key facts.",
        messages=[{"role": "user", "content": transcript}],
    )
    summary = "".join(b.text for b in reply.content if b.type == "text")

    print(f"  (compacted {len(older)} messages into a summary)")
    return [{"role": "user", "content": f"[Summary of earlier conversation]\n{summary}"}, *recent]
#endregion
