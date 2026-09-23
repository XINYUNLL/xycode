import type Anthropic from "@anthropic-ai/sdk";

// Autonomy: keep the agent working across many turns without a human at each
// step. /goal attaches a stop condition and an independent evaluator judges,
// after every turn, whether it's met — reinjecting the reason if not. --auto
// replaces the confirmation prompt with a classifier that reads the transcript
// and decides allow/block. Both are one-shot side calls to the model, distinct
// from the main loop (they route to their own mock tracks).

//#region goal
// An independent evaluator judges whether the condition is met. Returns MET, or
// NOT_MET with a reason that gets reinjected into the next turn.
export async function evaluateGoal(
  condition: string, transcript: string, client: Anthropic, model: string,
): Promise<{ met: boolean; reason: string }> {
  const reply = await client.messages.create({
    model, max_tokens: 256,
    system: "You are a goal evaluator. Given a condition and a transcript, reply exactly 'MET' if the condition is satisfied, otherwise 'NOT_MET: <short reason>'.",
    messages: [{ role: "user", content: `Condition: ${condition}\n\nTranscript so far:\n${transcript}` }],
  });
  const text = reply.content.filter((b) => b.type === "text").map((b: any) => b.text).join("").trim();
  if (text.startsWith("MET")) return { met: true, reason: "" };
  return { met: false, reason: text.replace(/^NOT_MET:?\s*/, "") };
}
//#endregion

//#region classifier
// A security monitor reads the transcript and decides whether a tool call is
// safe to run without asking the user. Reply ALLOW or BLOCK: <reason>.
export async function classifyAction(
  toolName: string, input: unknown, transcript: string, client: Anthropic, model: string,
): Promise<{ allow: boolean; reason: string }> {
  const reply = await client.messages.create({
    model, max_tokens: 256,
    system: "You are a security monitor for an autonomous coding agent. Given the transcript and a tool call, reply exactly 'ALLOW' if it is safe to run unattended, otherwise 'BLOCK: <short reason>'. Err on the side of blocking.",
    messages: [{ role: "user", content: `Transcript:\n${transcript}\n\nTool call: ${toolName}(${JSON.stringify(input)})` }],
  });
  const text = reply.content.filter((b) => b.type === "text").map((b: any) => b.text).join("").trim();
  if (text.startsWith("ALLOW")) return { allow: true, reason: "" };
  return { allow: false, reason: text.replace(/^BLOCK:?\s*/, "") };
}
//#endregion
