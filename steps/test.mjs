#!/usr/bin/env node
// Verify every step in both languages against the in-process mock — no API key.
// Assertions are behavioral (Gate 1): every scripted turn is consumed, the final
// turn is reached, each tool actually ran (its real output shows up in the
// tool_result the agent sent back), the system prompt contains what the chapter
// added, file side effects happened, and TS/Python stay at parity. checkStep is
// exported so test.selfcheck.mjs can prove the harness catches broken code.

import { startMock } from "./mock-anthropic.mjs";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { pathToFileURL, fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { tmpdir } from "os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const DIST = join(HERE, "dist");
const SCEN = join(HERE, "scenarios");
const TSC = join(REPO, "node_modules", ".bin", "tsc");
const VENV_PY = join(REPO, ".venv", "bin", "python");
const MCP_SERVER = join(HERE, "mcp-demo-server.mjs"); // ch12's demo MCP server

// Always lint + rebuild from canonical once per process — NEVER trust a stale
// dist. (A broken canonical must not pass just because an old dist is green.)
let built = false;
function ensureBuilt() {
  if (built) return;
  for (const script of ["lint-markers.mjs", "build.mjs"]) {
    const r = spawnSync("node", [join(HERE, script)], { stdio: "inherit" });
    if (r.status !== 0) { console.error(`ensureBuilt: ${script} failed`); process.exit(1); }
  }
  built = true;
}
const stepDirs = () => readdirSync(DIST).sort();
const stepName = (n) => stepDirs().find((s) => s.startsWith(String(n).padStart(2, "0") + "-"));
const readLog = (p) => existsSync(p) ? readFileSync(p, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
let scratchN = 0;
const scratch = () => { const d = join(tmpdir(), `steptest-${process.pid}-${scratchN++}`); rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); return d; };
function setupFiles(scenario, workdir) {
  for (const [name, content] of Object.entries(scenario.setup?.files || {})) {
    const p = join(workdir, name); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content);
  }
}

async function runTs(n, scenario, logPath, workdir) {
  const tsDir = join(DIST, stepName(n), "ts");
  // CLI-mode scenarios drive cli.ts; chat-mode drives agent.ts. Compile the entry.
  const entry = scenario.runs ? "cli.ts" : "agent.ts";
  const build = spawnSync(TSC, ["--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022",
    "--skipLibCheck", "--outDir", tsDir, join(tsDir, entry)], { encoding: "utf-8" });
  if (build.status !== 0) throw new Error(`tsc failed for step ${n}:\n${build.stdout}${build.stderr}`);
  setupFiles(scenario, workdir);
  const mock = await startMock({ scenario, logPath });
  const prev = { cwd: process.cwd(), base: process.env.ANTHROPIC_BASE_URL, key: process.env.ANTHROPIC_API_KEY, mcp: process.env.MINI_MCP_SERVER, write: process.stdout.write };
  let out = "";
  process.env.ANTHROPIC_BASE_URL = mock.url; process.env.ANTHROPIC_API_KEY = "test"; process.env.MINI_MCP_SERVER = MCP_SERVER;
  process.chdir(workdir);
  process.stdout.write = (s) => { out += s; return true; }; // capture, don't discard
  try {
    if (scenario.runs) {
      const mod = await import(pathToFileURL(join(tsDir, "cli.js")).href + `?t=${Date.now()}`);
      for (const run of scenario.runs) await mod.runCli(run.argv);
    } else {
      const mod = await import(pathToFileURL(join(tsDir, "agent.js")).href + `?t=${Date.now()}`);
      await new mod.Agent().chat(scenario.prompt);
    }
  } finally {
    process.stdout.write = prev.write; process.chdir(prev.cwd);
    process.env.ANTHROPIC_BASE_URL = prev.base; process.env.ANTHROPIC_API_KEY = prev.key; process.env.MINI_MCP_SERVER = prev.mcp;
    await mock.close();
  }
  return out;
}

function runPy(n, scenarioPath, logPath, workdir) {
  const pyDir = join(DIST, stepName(n), "py");
  const env = { ...process.env, MINI_MCP_SERVER: MCP_SERVER };
  for (const k of ["http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]) delete env[k];
  const r = spawnSync(VENV_PY, [join(HERE, "_pydriver.py"), pyDir, scenarioPath, logPath, workdir],
    { encoding: "utf-8", env, timeout: 30000 });
  if (r.status !== 0) throw new Error(`python driver failed for step ${n}:\n${(r.stderr || "").split("\n").slice(-6).join("\n")}`);
  return r.stdout || "";
}

// What must match across languages.
function normalize(log) {
  return JSON.stringify({
    requests: log.filter((e) => e.type === "request").map((e) => ({ tools: e.tools, toolResults: (e.toolResults || []).map((t) => t.content) })),
    responses: log.filter((e) => e.type === "response").map((e) => ({ stop_reason: e.stop_reason, tool_use: e.tool_use })),
    exhausted: log.some((e) => e.type === "exhausted"),
  });
}

// Run one step in both languages; return an array of failure strings (empty =
// pass). A step may map to one scenario or an array of them (e.g. ch15 tests
// both /goal and --auto).
export async function checkStep(n) {
  ensureBuilt();
  const map = JSON.parse(readFileSync(join(SCEN, "_map.json"), "utf-8"));
  const entry = map[String(n)];
  const confs = Array.isArray(entry) ? entry : [entry];
  const fails = [];
  for (const conf of confs) {
    const label = confs.length > 1 ? `${n}[${conf.scenario}]` : `${n}`;
    fails.push(...await runScenario(n, conf, label));
  }
  return fails;
}

async function runScenario(n, conf, label) {
  const scenarioPath = join(SCEN, conf.scenario + ".json");
  const scenario = JSON.parse(readFileSync(scenarioPath, "utf-8"));
  const expect = conf.expect || {};
  const fails = [];
  const norms = {};
  const tag = (lang, msg) => fails.push(`step${label} ${lang}: ${msg}`);

  for (const lang of ["ts", "py"]) {
    const workdir = scratch();
    const logPath = join(workdir, "_events.jsonl");
    let stdout = "";
    try {
      if (lang === "ts") stdout = await runTs(n, scenario, logPath, workdir);
      else { setupFiles(scenario, workdir); stdout = runPy(n, scenarioPath, logPath, workdir); }
    } catch (e) { tag(lang, "did not run: " + e.message.split("\n")[0]); continue; }

    const log = readLog(logPath);
    const requests = log.filter((e) => e.type === "request");
    const responses = log.filter((e) => e.type === "response");
    norms[lang] = normalize(log);

    if (log.some((e) => e.type === "exhausted")) tag(lang, "mock scenario exhausted (agent made an unexpected extra call)");
    if (log.some((e) => e.type === "ambiguous")) tag(lang, "mock request matched more than one track (routing collision)");
    // every scripted turn consumed = one request per turn (across all tracks)
    const totalTurns = scenario.turns ? scenario.turns.length
      : Object.values(scenario.tracks || {}).reduce((s, t) => s + (t.turns?.length || 0), 0);
    if (requests.length !== totalTurns) tag(lang, `made ${requests.length} model calls, expected ${totalTurns} (final turn not reached?)`);
    // reached the final turn
    const last = responses[responses.length - 1];
    if (expect.finalStopReason && (!last || last.stop_reason !== expect.finalStopReason)) tag(lang, `final stop_reason ${last?.stop_reason} != ${expect.finalStopReason}`);
    // the tools were actually invoked (in order)
    const gotTools = responses.flatMap((e) => (e.tool_use || []).map((x) => x.name));
    if (expect.toolCalls && JSON.stringify(gotTools) !== JSON.stringify(expect.toolCalls)) tag(lang, `tool calls [${gotTools}] != [${expect.toolCalls}]`);
    // each tool actually ran and produced the right output (its result was fed back)
    const allResults = requests.flatMap((e) => (e.toolResults || []).map((t) => t.content)).join("\n");
    for (const sub of expect.toolResultsContain || []) if (!allResults.includes(sub)) tag(lang, `no tool_result contained ${JSON.stringify(sub)} (tool didn't really run / wrong output)`);
    // the system prompt carries what this chapter added
    if (expect.systemContains && !requests.some((e) => (e.system || "").includes(expect.systemContains))) tag(lang, `system prompt missing ${JSON.stringify(expect.systemContains)}`);
    // aux tracks (ch7 compaction, ch15 goal/classifier): the side call really happened
    for (const t of expect.tracksUsed || []) if (!requests.some((e) => e.track === t)) tag(lang, `no request on track "${t}" (the ${t} aux call didn't happen)`);
    // exact per-track request counts (catches an aux call firing too many/few times)
    for (const [t, c] of Object.entries(expect.trackCounts || {})) {
      const got = requests.filter((e) => e.track === t).length;
      if (got !== c) tag(lang, `track "${t}" had ${got} requests, expected ${c}`);
    }
    if (expect.stdoutContains && !stdout.includes(expect.stdoutContains)) tag(lang, `stdout missing ${JSON.stringify(expect.stdoutContains)}`);
    // a request's first user message carries what we injected (ch9 skill prompt)
    if (expect.firstUserContains && !requests.some((e) => (e.firstUserText || "").includes(expect.firstUserContains))) tag(lang, `no request first-user text contained ${JSON.stringify(expect.firstUserContains)}`);
    // file side effects
    for (const [name, content] of Object.entries(expect.files || {})) {
      const p = join(workdir, name);
      if (!existsSync(p) || readFileSync(p, "utf-8") !== content) tag(lang, `file ${name} not written with expected content`);
    }
    // files that must NOT exist (e.g. a write blocked by plan/auto mode)
    for (const name of expect.filesAbsent || []) {
      if (existsSync(join(workdir, name))) tag(lang, `file ${name} should not exist (a blocked write leaked through)`);
    }
    // session persistence (ch4): the session file exists, and --resume actually
    // restored the prior conversation (the original first user message is back).
    if (expect.sessionFile && !existsSync(join(workdir, expect.sessionFile))) tag(lang, `session file ${expect.sessionFile} not written`);
    if (expect.resumedFirstUser) {
      const lastReq = requests[requests.length - 1];
      if (!lastReq || !(lastReq.firstUserText || "").includes(expect.resumedFirstUser)) tag(lang, `resume didn't restore prior context (last request first user: "${lastReq?.firstUserText}")`);
    }
    rmSync(workdir, { recursive: true, force: true });
  }
  if (norms.ts !== norms.py) fails.push(`step${label}: ts/py parity — event logs differ`);
  return fails;
}

async function main() {
  ensureBuilt();
  const map = JSON.parse(readFileSync(join(SCEN, "_map.json"), "utf-8"));
  const steps = Object.keys(map).map(Number).sort((a, b) => a - b);
  const allFails = [];
  for (const n of steps) {
    const fails = await checkStep(n);
    console.log(fails.length ? `FAIL step${n}:\n  ${fails.join("\n  ")}` : `ok   step${n} (ts+py: turns consumed, tools ran, results fed back, parity)`);
    allFails.push(...fails);
  }
  console.log(allFails.length ? `\nTESTS FAILED (${allFails.length})` : `\nALL TESTS PASSED (${steps.length} steps × 2 languages)`);
  process.exit(allFails.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
