import type Anthropic from "@anthropic-ai/sdk";

// When the conversation gets long, summarize the older messages into one so the
// context window doesn't overflow. Real agents count tokens; we count messages,
// which is enough to see the mechanism work.
const COMPACT_THRESHOLD = 6;
const KEEP_RECENT = 2;

//#region compact
export async function maybeCompact(
  messages: Anthropic.MessageParam[],
  client: Anthropic,
  model: string,
): Promise<Anthropic.MessageParam[]> {
  if (messages.length <= COMPACT_THRESHOLD) return messages;

  const older = messages.slice(0, messages.length - KEEP_RECENT);
  const recent = messages.slice(messages.length - KEEP_RECENT);

  // One aux model call: summarize the older messages (rendered as plain text so
  // we never split a tool_use / tool_result pair).
  const transcript = older
    .map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : "[tool call / result]"}`)
    .join("\n");
  const reply = await client.messages.create({
    model, max_tokens: 1024,
    system: "Summarize the conversation so far in a few sentences, keeping key facts.",
    messages: [{ role: "user", content: transcript }],
  });
  const summary = reply.content.filter((b) => b.type === "text").map((b: any) => b.text).join("");

  console.log(`  (compacted ${older.length} messages into a summary)`);
  return [{ role: "user", content: `[Summary of earlier conversation]\n${summary}` }, ...recent];
}
//#endregion
