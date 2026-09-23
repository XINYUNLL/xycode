// Control-flow tests for the two-stage Auto Mode classifier, using node:test.
// These stub the per-stage classifier query (no network) and drive
// Agent.classifyToolCall directly, so the two-stage wiring itself is covered:
// stage-1 gate, stage-1→stage-2 escalation, denial counting, and fail-closed
// parsing. The pure functions are covered separately in autonomy.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/agent.js";

// Build an Agent whose classifier query returns canned per-stage responses.
// `calls` records how many stage queries were made.
function mkAgent(responses: string[]): { agent: any; calls: { n: number } } {
  const agent: any = new Agent({ apiKey: "test-key", permissionMode: "auto" });
  const calls = { n: 0 };
  agent.runClassifierQuery = async () => {
    const r = responses[calls.n] ?? "<block>yes</block><reason>[fallback] ran out of canned responses</reason>";
    calls.n++;
    return r;
  };
  return { agent, calls };
}

test("stage 1 allow → allow in one call", async () => {
  const { agent, calls } = mkAgent(["<block>no</block>"]);
  const r = await agent.classifyToolCall("run_shell", { command: "echo hi" });
  assert.equal(r.action, "allow");
  assert.equal(calls.n, 1, "stage 2 must not run when stage 1 allows");
});

test("stage 1 block → stage 2 allow (intent clears)", async () => {
  const { agent, calls } = mkAgent([
    "<block>yes</block><reason>[Git Push to Default Branch] main</reason>",
    "<block>no</block>",
  ]);
  const r = await agent.classifyToolCall("run_shell", { command: "echo hi" });
  assert.equal(r.action, "allow");
  assert.equal(calls.n, 2, "stage 2 must run after a stage 1 block");
});

test("stage 1 block → stage 2 block → deny, denial counted once", async () => {
  const { agent, calls } = mkAgent([
    "<block>yes</block><reason>[Git Push to Default Branch] a</reason>",
    "<block>yes</block><reason>[Git Push to Default Branch] b</reason>",
  ]);
  const r = await agent.classifyToolCall("run_shell", { command: "echo hi" });
  assert.equal(r.action, "deny");
  assert.match(r.message, /\[Auto Mode\]/);
  assert.equal(calls.n, 2);
  assert.equal(agent.autoConsecutiveDenials, 1, "one blocked action → one denial, not two");
});

test("stage 2 unparseable → block (fail-closed)", async () => {
  const { agent } = mkAgent([
    "<block>yes</block><reason>[X] a</reason>",
    "garbage, not a verdict",
  ]);
  const r = await agent.classifyToolCall("run_shell", { command: "echo hi" });
  assert.equal(r.action, "deny");
});

test("fast-path tool skips the classifier entirely", async () => {
  const { agent, calls } = mkAgent(["<block>yes</block><reason>should not be used</reason>"]);
  const r = await agent.classifyToolCall("read_file", { file_path: "x" });
  assert.equal(r.action, "allow");
  assert.equal(calls.n, 0, "read-only tools must not call the classifier");
});
