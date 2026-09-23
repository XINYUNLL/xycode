# Runnable Steps — Design

How this repo turns the tutorial into a **from-scratch build you can run at every
chapter**. This document is the blueprint; it was reviewed by an independent
model (Codex, Gate 0) and incorporates that review.

## 1. Goal & principles

A reader should feel they are *building* a coding agent, one runnable step at a
time — not reading a finished codebase. Concretely:

1. **No-key first run.** The first command in every chapter runs against a local
   mock model — `npm install` is the only setup. Feeling the thing work must not
   require an API key. Real models are an optional `--live` smoke, never the main
   path. (nanoGPT's "feel the magic" quick start.)
2. **Diff-first narrative.** A chapter reads: *run the previous step and watch it
   fail or fall short → here is the small diff this chapter adds → run this step
   and watch the new behavior.* The full snapshot is an entrypoint at the end,
   not the opening. The "I built this" feeling comes from the diff + observed
   change, which single-source slicing alone does **not** produce.
3. **One source, everything generated.** `steps/canonical/` is the only hand-
   written code. Per-chapter snapshots, the code blocks in the docs, and the
   example transcripts are all generated from it. Change canonical → regenerate →
   CI `git diff --exit-code` blocks any drift.
4. **Every step runs, proven by CI with no key.** Each step, in both languages,
   compiles/imports and passes a scripted scenario against the mock — asserting
   machine-observable events (tool calls, side-effect files, control flow), never
   the model's natural language.
5. **Seams, not rewrites.** New capabilities enter at a small set of named
   integration points (§3). A chapter that needs a seam introduces it as that
   chapter's explicit refactor — we do not pre-stub empty hooks, and we do not
   pretend the loop never changes.
6. **Small enough to read; mirrored in two languages.** Each step's core files
   are tens of lines, single-backend (Anthropic only). TS and Python are kept
   behaviorally identical, enforced by a parity check on a normalized event log.

Production `src/` and `python/mini_claude/` stay untouched as the *fuller*
reference; ch13 compares three tiers: your final step → this repo's production
version → real Claude Code.

## 2. Layout

```
steps/
  canonical/{ts,py}/     # ONLY hand-written source. #step (slice) + #region (doc) markers.
  scenarios/*.json       # shared scripted model behavior — used by test, run --demo, @transcript
  build.mjs              # canonical --slice--> dist/<step>/{ts,py}  (self-contained snapshots)
  run.mjs                # run a step: --demo (default, no key) | --live | --diff | --list | --py | -- <prompt>
  mock-anthropic.mjs     # local server speaking the real Anthropic /v1/messages (+SSE) protocol
  mock-anthropic.selftest.mjs  # proves the real TS & Python SDKs work against the mock
  docs-sync.mjs          # inject @snippet / @diff / @transcript into docs/ & en/docs/ ; lint ; normalize
  test.mjs               # every step × {ts,py} × scenario: compile/import + assert + parity
  lint-markers.mjs       # validate #step / #region / @snippet integrity
  DESIGN.md              # this file
  dist/                  # generated, gitignored
```

## 3. Seam matrix (the named integration points)

The agent is written so capabilities attach at these seams. A chapter's diff is
"introduce/extend seam X". This keeps the loop legible and bounds the marker
churn. Seams are added at the chapter that first needs them (not upfront):

| Seam | First chapter | What plugs in later |
|------|---------------|---------------------|
| `callModel(req)` | 1 (inline) | ch5 turns it into the streaming call; it is the single model-call site |
| `toolRegistry` | 2 | ch9 skill / ch11 agent / ch12 mcp add tools |
| `executeToolCall(name,input)` | 2 | ch6 wraps it with `permissionGate` |
| `buildRequest()` (system+tools+messages) | 3 | ch3 system prompt; ch8 memory injection |
| `history` / message array | 1 | ch7 compaction rewrites it; ch4 save/resume serializes it |
| `runCli(argv)` / `slashCommand(input)` | 4 | ch7 `/compact`, ch9 `/skill`, ch10 `/plan`, ch15 `/goal` `/loop` |
| `sessionStore` | 4 | save/resume |
| `permissionGate(call)` | 6 | ch10 plan-mode read-only, ch15 auto classifier |
| `beforeTurn()` / `afterAssistant()` | 7 | ch7 compaction at turn boundary; ch8 memory prefetch |
| `auxModelCall(kind, system, messages)` | 7 | one-shot side calls: ch7 compact summary, ch15 goal evaluator, ch15 auto classifier (distinct from the main loop's `callModel`) |
| `eventSink` / trace | 3 | `--trace-request` (ch3 system), `--trace-stream` (ch5 chunks); the observable substrate for demos/tests |
| `clock` / scheduler | 15 | ch15 `/loop` — injectable so CI never really sleeps 60s |

Gate 0/1 correction: "loop only changes at ch5/ch6" was wrong. Context
(turn-boundary tool_use/tool_result pairing), memory (inject around the model
call), tool routing (mcp/subagent/skill), plan mode, and the aux one-shot calls
(compact/goal/classifier) all touch the core. `callModel` is inline in ch1 and
becomes the streaming call in ch5 — it is NOT abstracted early (no empty hooks);
each seam is introduced at the chapter that first needs it. `auxModelCall` is a
*separate* model-call site from `callModel` so the mock can tell a compaction /
evaluator / classifier request apart from a main-loop request (see scenarios).

## 4. Chapter → step map

13 code steps (ch1-12 + ch15); ch13/14 are doc-only.

| Ch | Step | New (prefer a new file) | No-key demo asserts (observable event) |
|----|------|-------------------------|----------------------------------------|
| 1 | 1 | `agent.ts`(**non-streaming** loop)+`tools.ts`(read_file)+`cli.ts` | reads a file → `read_file` call in event log |
| 2 | 2 | `tools.ts` grows to 6 tools | writes a file → file exists on disk |
| 3 | 3 | +`prompt.ts`; `buildRequest` uses it | `--trace-request` shows the system prompt block |
| 4 | 4 | `cli.ts`: arg parse + `sessionStore` + `/clear` etc | resume a saved session → prior message reloaded |
| 5 | 5 | `callModel`: `create`→`stream` (only change) | `--trace-stream` shows >1 text chunk over time |
| 6 | 6 | +`permissions.ts`; `permissionGate` wraps executeToolCall | `rm -rf` is denied → deny event, no side effect |
| 7 | 7 | +`context.ts`; `beforeTurn` compaction; `/compact` | mock forces high usage → message count drops / summary event |
| 8 | 8 | +`memory.ts`; deterministic top-k recall injected in `buildRequest` | new session → memory file read + injection event (no extra model call) |
| 9 | 9 | +`skills.ts`; `/name` → registry | `/commit` → skill prompt injected event |
| 10 | 10 | +`plan.ts`; `--plan`/`/plan` via permissionGate | plan mode → write tool denied event |
| 11 | 11 | +`subagent.ts`; `agent` tool | `agent(explore)` → sub-agent event + isolated tools |
| 12 | 12 | +`mcp.ts` (stdio JSON-RPC, version-negotiated) | event log shows `initialize` / `tools/list` / `tools/call` |
| 13 | — | doc-only | three-tier comparison |
| 14 | — | doc-only | walks through steps/test.mjs (same harness that tests the book) |
| 15 | 13 | +`autonomy.ts`; `sideQuery`; `/goal` `/loop` `--auto` | goal: evaluator verdict + 2nd-turn reinjection in event log |

Decisions locked by Gate 0:
- **ch1-4 are non-streaming** (`messages.create`). ch5 is the "swap the call shape"
  chapter. (The pilot currently streams from ch1 — Phase A fixes this.) Dual
  backend is *not* in the teaching trunk; it stays a production-only feature.
- **ch8 recall is deterministic** (keyword/index top-k, no model call). `sideQuery`
  is introduced later, at ch15, and reused by the auto classifier.
- **ch12 MCP** teaches stdio only; the mock MCP server negotiates protocol
  version; docs do not hardcode a dated version as "current".

## 5. Markers + linter

- **Slice** `#step`: `//#step >=N | ==N | <=N | <N | >N` (TS), `#step …` (Py),
  closed by `//#endstep` / `#endstep`. Consecutive `#step` before an end = if/elif
  (first matching branch wins). Implemented in `build.mjs`.
- **Doc region** `#region NAME` … `#endregion`: names a span for the docs. The
  region is extracted from the **sliced** file for a given step, so a doc snippet
  always equals code that really exists in that chapter's snapshot.
- **`lint-markers.mjs`** fails the build on: unbalanced markers, unknown region
  referenced by a `@snippet`, empty region, duplicate region name in one file,
  a `@snippet`/`@diff`/`@transcript` whose target step/region doesn't exist.

## 6. Scenarios + mock + event log

- **`steps/scenarios/*.json`** is the single source of scripted model behavior.
  A turn is `{tools:[{name,input}], text?}` (tool_use) or `{text}` (final).
  `steps/scenarios/_map.json` maps each step to its scenario **and** its
  expectations (what the chapter must prove: `toolCalls`, `toolResultsContain`,
  `systemContains`, `files`, `finalStopReason`). `test.mjs`, `run --demo`, and
  `@transcript` read the same scenario — no third copy to drift. (Gate 0 P2.)
  - *Single-loop vs multi-track (Gate 1 P0):* ch1-6 have one model-call loop, so
    a flat `turns` list keyed by assistant-message count is enough. From **ch7**
    the agent makes *aux* one-shot calls (compact summary; ch11 sub-agents; ch15
    goal evaluator / auto classifier) that are NOT the main loop — a sub-agent's
    first request also has assistantCount 0. So at ch7 the scenario gains
    `tracks: { main: [...], "compact": [...], "subagent:explore": [...], "auto:stage1": [...], "goal": [...] }`
    and the mock **routes each request to a track by its shape** (system prompt /
    tools / first user message), logging the `track`; tests assert every track is
    consumed. `turns` stays as sugar for `{ main: turns }`. This is implemented
    when ch7 lands (not stubbed early); Gate 3 re-checks it. MCP (ch12) is a
    stdio subprocess with its own mock server + JSONL log, separate from the
    model mock.
- **Mock is in-process, per language.** `mock-anthropic.mjs` (Node) and
  `mock_anthropic.py` (Python) both implement the real Anthropic `POST
  /v1/messages` — `create` and SSE `stream`, `tool_use` blocks, `usage`, errors —
  and both read the SAME `scenarios/*.json`. A test/demo starts the mock **in the
  same process/runtime as the step it drives** (Node mock ↔ TS steps; Python mock
  ↔ Python steps) and drives the step by importing its `Agent` class with
  `ANTHROPIC_BASE_URL` pointed at the in-process mock. There is still no `if
  (test)` branch in the teaching code — only an env var and an imported class.
  - *Why in-process, per language:* on the dev host, mihomo intercepts
    cross-process loopback, so a subprocess step cannot reach a mock server in
    another process (verified). Same-process loopback works everywhere (dev host,
    CI, reader machines), so the in-process design is strictly more robust. It
    also gives cleaner assertions (drive `Agent.chat()` directly). The two small
    mocks mirror each other and share the scenario JSON, so they cannot drift
    behaviorally.
- On queue exhaustion the mock returns an error and the run **fails** (never a
  false green). It emits an **event log** (JSONL): every request (system, tools,
  messages), every tool_use it issued, and usage — the machine-observable
  substrate for assertions and transcripts.
- **Conformance selftests** prove protocol fidelity before any step depends on
  it: `mock-anthropic.selftest.mjs` drives the **Node** mock with the real TS SDK
  (create, stream, tool_use); `mock_anthropic.selftest.py` drives the **Python**
  mock with the real Python SDK (create, stream text chunks, stream tool input,
  usage, exhaustion→error). Each is same-process (the only loopback shape that
  works on the dev host). `test.mjs` then exercises both mocks end-to-end.

## 7. test.mjs

For each step × {ts, py}, run the scenario against the in-process mock and assert
**behaviorally** (Gate 1 — the earlier "did the mock emit a tool name" check was
false-green and is gone):
1. compile (tsc) / import (py) — must pass, **no skips** (a missing Python env
   fails, it does not pass vacuously).
2. **every scripted turn consumed** (one model call per turn) and the **final
   turn reached** (`stop_reason == end_turn`) — catches an agent that stops
   feeding tool results back.
3. **each tool really ran**: its real output appears in the `tool_result` the
   agent sent back (`toolResultsContain`) — catches a broken/stubbed tool.
4. **the system prompt carries what the chapter added** (`systemContains`) —
   catches a broken prompt.
5. **file side effects** happened; natural language only via `contains`.
6. **parity**: TS and Python produce the same normalized event log (requests,
   tool_result contents, responses).

`test.selfcheck.mjs` is the meta-test: it applies three mutations (garbage
`read_file`, agent never feeds results back, broken system prompt) to canonical,
regenerates, and asserts `test.mjs` goes **red** for each — so the harness is
proven to catch broken code, not just pass. Deterministic, no API key → CI.

## 8. docs-sync.mjs

Markdown carries HTML-comment placeholders; the script fills between them,
idempotently, and CI runs `git diff --exit-code` to catch drift.

- `@snippet lang=ts file=agent.ts region=loop step=2` → the region, sliced at that
  step.
- `@diff step=N file=agent.ts` → the unified diff of file between step N-1 and N
  (the chapter's change, in the main narrative — Gate 0 P0).
- `@transcript scenario=read-a-file step=1 lang=ts` → the **real** stdout of
  running that step against the mock, captured in a **fixed temp workspace**
  (normalized paths, no real dates, ANSI stripped — Gate 0 P1) so it is stable.
- Hardening: empty snippet fails, duplicate/unknown region fails, unsynced doc
  fails, path/time/ANSI normalization.

## 9. run.mjs

- `node steps/run.mjs <N>` → **default `--demo`**: starts the mock, sets a dummy
  key, isolates a temp cwd/HOME, runs the step's demo scenario. No key needed.
- `--live` → real API via `.env` (proxy stripped); optional smoke.
- `--diff` → what this chapter added vs the previous (also available as `@diff` in
  docs).
- `--list` → steps + one-line capabilities. `--py` → Python. `-- "<prompt>"` →
  one-shot (live) or drive the demo.

## 10. Execution: per-step closed loop (Gate 0 P1)

After the ch1-3 template is set, **each chapter is a full vertical loop** before
moving on (codecrafters "one stage at a time"): canonical slice (both langs) →
mock test green → doc `@snippet`+`@diff`+`@transcript` (zh+en) → `--diff` self-
check → read the chapter through. Not "all code, then all docs".

## 11. Phases & Codex gates

- **Gate 0 (plan)** — done; this doc incorporates it.
- **Phase A — foundations**: seam matrix; `lint-markers.mjs`; `mock-anthropic.mjs`
  + selftest (real TS+Py SDK); `scenarios/`; `test.mjs`; `run.mjs` `--demo`
  default + `--diff`/`--list`; revise pilot ch1-3 to **non-streaming** + add
  `#region` + demo scenarios; ch1-3 mock-test green + representative `--live`
  smoke. → **Gate 1** (foundations architecture, mock fidelity, no test-hooks in
  teaching code, seam matrix).
- **Phase B — doc/code loop on ch1-3**: `docs-sync.mjs`; wire ch1-3 zh+en docs
  (@snippet/@diff/@transcript + ▶run); drift check green; read all four. →
  **Gate 2** (doc-code sync + ch1-3 as the whole-book template: readability &
  usefulness).
- **Phase C/D merged — per-chapter closed loop** for ch4→ch12→ch15, each: code +
  mock test + docs + transcript + diff + read-through, batched commits. →
  **Gate 3** (mid: code-step quality, parity, demos observable) and **Gate 4**
  (full-book doc consistency, from-scratch feel, facts).
- **Phase E — final**: full mock test suite green (both langs); representative
  `--live` smoke; docs-sync drift check; readable-writing blockers=0 all zh;
  read every zh+en chapter end-to-end; → **Gate 5 (final)** → push.

Each gate: `/cross-review` or `ask-codex.sh` (gpt-5.5 xhigh, web), triage P0/P1,
record in progress notes.

## 12. Goal DoD (revised per Gate 0)

1. canonical covers ch1-12 + ch15 in TS+Python; build/run (`--demo` default,
   `--live`, `--diff`, `--list`, `--py`, one-shot) work.
2. `mock-anthropic` + `test.mjs`: every step × both languages green with **no API
   key** (assert event log + parity, no skips). `--live` smoke on a
   representative 3-4 steps recorded (date/model), **non-blocking**.
3. every code chapter's docs/ + en/docs/ code blocks generated from canonical
   (no hand-copied), with `@diff` in the narrative, a ▶run entry, and a captured
   `@transcript`; `git diff --exit-code` drift check green.
4. all zh chapters readable-writing blockers=0; every chapter zh+en read end-to-
   end for readability/usefulness, issues fixed.
5. 5 Codex gates passed, P0/P1 resolved.
6. committed in phases; pushed to GitHub.

## 13. Risks

- **Canonical marker churn** → seam matrix + `lint-markers` + mock-test each step
  immediately; favor new files.
- **Mock false-green / SDK mismatch** → selftest with real SDKs first; queue
  exhaustion fails; no skips.
- **Doc migration volume** → per-chapter closed loop, templated on ch1-3; prose
  (already reframed) untouched, only code blocks swapped for placeholders.
- **Runway** → durable commit per chapter; ch1-3 vertical slice done first is a
  complete, usable deliverable; if incomplete, report done-vs-remaining and push
  what's verified.
- **Live key** → inferera key works now; CI never depends on it.
