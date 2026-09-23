#!/usr/bin/env node
// Prove the test harness actually catches broken code — the three mutations
// Codex used in Gate 1 to show the old assertions were false-green. Each mutation
// is applied to the canonical source, regenerated, and checkStep() MUST report a
// failure. If a mutation slips through green, this selfcheck fails.

import { checkStep } from "./test.mjs";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANON = join(HERE, "canonical");
const rebuild = () => spawnSync("node", [join(HERE, "build.mjs")], { stdio: "ignore" });

const MUTATIONS = [
  { name: "read_file returns garbage", step: 1, edits: [
    ["ts/tools.ts", 'return lines.map((l, i) => `${String(i + 1).padStart(4)} | ${l}`).join("\\n");', 'return "BROKEN READ";'],
    ["py/tools.py", 'return "\\n".join(f"{i + 1:4d} | {line}" for i, line in enumerate(lines))', 'return "BROKEN READ"'],
  ]},
  { name: "agent never feeds tool_result back", step: 1, edits: [
    ["ts/agent.ts", "this.messages.push({ role: \"user\", content: results });", "return; // MUTANT"],
    ["py/agent.py", 'self.messages.append({"role": "user", "content": results})', "return  # MUTANT"],
  ]},
  { name: "system prompt is broken", step: 3, edits: [
    ["ts/prompt.ts", "Do not propose changes to code you haven't read. Read files first.", "BROKEN SYSTEM"],
    ["py/prompt.py", "Do not propose changes to code you haven't read. Read files first.", "BROKEN SYSTEM"],
  ]},
  { name: "permission gate never denies", step: 6, edits: [
    ["ts/permissions.ts", 'return "deny";', 'return "allow"; // MUTANT'],
    ["py/permissions.py", 'return "deny"', 'return "allow"  # MUTANT'],
  ]},
  { name: "compaction never fires", step: 7, edits: [
    ["ts/context.ts", "const COMPACT_THRESHOLD = 6;", "const COMPACT_THRESHOLD = 99999;"],
    ["py/context.py", "COMPACT_THRESHOLD = 6", "COMPACT_THRESHOLD = 99999"],
  ]},
  { name: "auto-mode monitor never blocks", step: 15, edits: [
    ["ts/agent.ts", "if (!verdict.allow) {", "if (false) { // MUTANT"],
    ["py/agent.py", 'if not verdict["allow"]:', "if False:  # MUTANT"],
  ]},
];

let bad = 0;
for (const m of MUTATIONS) {
  const backups = m.edits.map(([f]) => [f, readFileSync(join(CANON, f), "utf-8")]);
  try {
    for (const [f, from, to] of m.edits) {
      const p = join(CANON, f); const src = readFileSync(p, "utf-8");
      if (!src.includes(from)) throw new Error(`mutation target not found in ${f}`);
      writeFileSync(p, src.replace(from, to));
    }
    rebuild();
    const fails = await checkStep(m.step);
    if (fails.length > 0) console.log(`ok   caught: ${m.name} (step${m.step}) — ${fails.length} assertion(s) fired`);
    else { console.log(`MISS uncaught: ${m.name} (step${m.step}) stayed GREEN`); bad++; }
  } catch (e) {
    console.log(`ERR  ${m.name}: ${e.message}`); bad++;
  } finally {
    for (const [f, src] of backups) writeFileSync(join(CANON, f), src);
  }
}
rebuild();
console.log(bad ? `\nSELFCHECK FAILED: ${bad} mutation(s) not caught` : `\nSELFCHECK PASSED: harness catches all ${MUTATIONS.length} mutations`);
process.exit(bad ? 1 : 0);
