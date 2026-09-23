// Golden-fixture tests for the autonomy pure functions, using Node's built-in
// test runner (zero extra deps). Reads test/fixtures/autonomy-golden.json — the
// SAME file the Python suite reads — so /goal, /loop, and Auto Mode stay in sync
// across the two language mirrors. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseDurationToSeconds, clampWakeupDelay, isDailyWording,
  projectActionForClassifier, parseGoalVerdict, parseBlockVerdict,
  parseLoopInput, buildClassifierTranscript,
} from "../src/autonomy.js";

const fixturesPath = fileURLToPath(new URL("../../test/fixtures/autonomy-golden.json", import.meta.url));
const golden = JSON.parse(readFileSync(fixturesPath, "utf8"));

test("parseDurationToSeconds", () => {
  for (const c of golden.parseDurationToSeconds) {
    assert.equal(parseDurationToSeconds(c.token), c.expected, `token=${c.token}`);
  }
});

test("clampWakeupDelay", () => {
  for (const c of golden.clampWakeupDelay) {
    assert.equal(clampWakeupDelay(c.seconds as any), c.expected, `seconds=${c.seconds}`);
  }
});

test("isDailyWording", () => {
  for (const c of golden.isDailyWording) {
    assert.equal(isDailyWording(c.raw), c.expected, `raw=${c.raw}`);
  }
});

test("projectActionForClassifier", () => {
  for (const c of golden.projectActionForClassifier) {
    assert.equal(projectActionForClassifier(c.tool, c.input), c.expected, `tool=${c.tool}`);
  }
});

test("parseGoalVerdict", () => {
  for (const c of golden.parseGoalVerdict) {
    assert.deepEqual(parseGoalVerdict(c.raw), c.expected, `raw=${c.raw}`);
  }
});

test("parseBlockVerdict", () => {
  for (const c of golden.parseBlockVerdict) {
    assert.deepEqual(parseBlockVerdict(c.raw), c.expected, `raw=${c.raw}`);
  }
});

test("parseLoopInput", () => {
  for (const c of golden.parseLoopInput) {
    const r: any = parseLoopInput(c.raw);
    const e: any = c.expected;
    if (e.error) {
      assert.equal(r.error, e.error, `raw=${c.raw}`);
      continue;
    }
    assert.equal(r.mode, e.mode, `raw=${c.raw} mode`);
    assert.equal(r.prompt, e.prompt, `raw=${c.raw} prompt`);
    if (e.mode === "interval") {
      assert.equal(r.intervalSeconds, e.seconds, `raw=${c.raw} seconds`);
      assert.equal(r.intervalLabel, e.label, `raw=${c.raw} label`);
    }
  }
});

test("buildClassifierTranscript", () => {
  for (const c of golden.buildClassifierTranscript) {
    const out = buildClassifierTranscript(c.history, { toolName: c.pending.tool, input: c.pending.input });
    assert.equal(out, c.expected);
  }
});
