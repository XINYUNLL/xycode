// A local server that speaks the real Anthropic Messages API (POST /v1/messages,
// both blocking and SSE streaming) and replays a *scripted* scenario. The agent
// code is unmodified — only ANTHROPIC_BASE_URL points here — so there is no test
// branch in the teaching code.
//
// Which scripted turn to return is derived from the request itself: the number
// of assistant messages already in `messages` is the index of the next turn.
// That is stateless and matches however the client replays history.
//
// A scenario is { id, turns: [ turn, ... ] } where a turn is:
//   { "tools": [ { "name": "...", "input": {...} } ], "text": "optional preamble" }  -> stop_reason tool_use
//   { "text": "..." }                                                                 -> stop_reason end_turn
//   optional per-turn { "usage": { "input_tokens": N, "output_tokens": M } }
//
// Every request is appended to MOCK_LOG (JSONL) as an event the tests assert on.

import { createServer } from "http";
import { appendFileSync } from "fs";

function messageFromTurn(turn, model, reqIndex) {
  const content = [];
  if (turn.text && (turn.tools?.length)) content.push({ type: "text", text: turn.text });
  else if (turn.text) content.push({ type: "text", text: turn.text });
  (turn.tools || []).forEach((t, j) => {
    content.push({ type: "tool_use", id: `toolu_mock_${reqIndex}_${j}`, name: t.name, input: t.input ?? {} });
  });
  const stop_reason = turn.tools?.length ? "tool_use" : "end_turn";
  const usage = turn.usage || { input_tokens: 100, output_tokens: 20 };
  return { id: `msg_mock_${reqIndex}`, type: "message", role: "assistant", model, content, stop_reason, stop_sequence: null, usage };
}

function writeBlocking(res, msg) {
  const body = JSON.stringify(msg);
  // Connection: close — otherwise undici keeps the socket alive and, on Windows,
  // Node's libuv asserts at process exit (UV_HANDLE_CLOSING) because the socket
  // is still open when the process tears down.
  res.writeHead(200, { "content-type": "application/json", connection: "close" });
  res.end(body);
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function writeStreaming(res, msg) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "close" });
  sse(res, "message_start", { type: "message_start", message: { ...msg, content: [], stop_reason: null, usage: { ...msg.usage, output_tokens: 0 } } });
  msg.content.forEach((block, i) => {
    if (block.type === "text") {
      sse(res, "content_block_start", { type: "content_block_start", index: i, content_block: { type: "text", text: "" } });
      // Split text into a few chunks so streaming is observably chunked.
      const chunks = block.text.match(/.{1,24}(\s|$)|.+$/g) || [block.text];
      for (const c of chunks) sse(res, "content_block_delta", { type: "content_block_delta", index: i, delta: { type: "text_delta", text: c } });
      sse(res, "content_block_stop", { type: "content_block_stop", index: i });
    } else {
      sse(res, "content_block_start", { type: "content_block_start", index: i, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      sse(res, "content_block_delta", { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
      sse(res, "content_block_stop", { type: "content_block_stop", index: i });
    }
  });
  sse(res, "message_delta", { type: "message_delta", delta: { stop_reason: msg.stop_reason, stop_sequence: null }, usage: { output_tokens: msg.usage.output_tokens } });
  sse(res, "message_stop", { type: "message_stop" });
  res.end();
}

// Start the mock. Returns { url, close, port }.
// A scenario is either flat ({turns}) — one "main" track — or multi-track
// ({tracks: {main: {turns}, compact: {match, turns}, ...}}). Each request is
// routed to a track by a substring its `match` finds in the system prompt (so an
// aux call like compaction can be told apart from the main loop); "main" is the
// fallback. Each track has its own request counter, so aux calls don't disturb
// the main loop's turn index.
export function startMock({ scenario, logPath } = {}) {
  const tracks = scenario?.tracks || { main: { turns: scenario?.turns || [] } };
  const counters = {};
  let reqIndex = 0;

  const server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
      res.writeHead(404); res.end("not found"); return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      let body;
      try { body = JSON.parse(raw); } catch { res.writeHead(400); res.end("bad json"); return; }

      const system = typeof body.system === "string" ? body.system : (Array.isArray(body.system) ? body.system.map((b) => b.text).join("") : "");
      const firstUserText = (() => { const m = (body.messages || []).find((x) => x.role === "user"); return typeof m?.content === "string" ? m.content : ""; })();
      const toolNames = (body.tools || []).map((t) => t.name);
      // Route to an aux track by a structured match (system substring + optional
      // firstUser / tools). Check ALL tracks, not first-hit, and fail loudly on
      // ambiguity — a request must never match two tracks (that's a scenario bug,
      // or a track marker string that collided with the main system prompt).
      const matches = (t) =>
        (!t.match || system.includes(t.match)) &&
        (!t.firstUserContains || firstUserText.includes(t.firstUserContains)) &&
        (!t.toolsInclude || t.toolsInclude.every((n) => toolNames.includes(n)));
      const hits = Object.entries(tracks).filter(([name, t]) => name !== "main" && t.match && matches(t));
      let track = "main";
      if (hits.length > 1) {
        const err = { type: "error", error: { type: "mock_ambiguous_route", message: `request matched multiple tracks: ${hits.map(([n]) => n).join(", ")}` } };
        if (logPath) appendFileSync(logPath, JSON.stringify({ type: "ambiguous", req: reqIndex, tracks: hits.map(([n]) => n), system }) + "\n");
        res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify(err)); return;
      }
      if (hits.length === 1) track = hits[0][0];
      const turnIndex = counters[track] || 0;
      const turn = (tracks[track]?.turns || [])[turnIndex];

      // tool_result blocks the agent sent back — proof the tool actually ran,
      // with its real output (a broken tool shows up here as wrong content).
      const toolResults = [];
      for (const m of body.messages || []) {
        if (Array.isArray(m.content)) for (const b of m.content) {
          if (b.type === "tool_result") toolResults.push({ tool_use_id: b.tool_use_id, content: typeof b.content === "string" ? b.content : JSON.stringify(b.content) });
        }
      }
      if (logPath) {
        appendFileSync(logPath, JSON.stringify({
          type: "request",
          req: reqIndex,
          track,
          turnIndex,
          system,
          tools: toolNames,
          toolResults,
          messageCount: (body.messages || []).length,
          firstUserText,
          stream: !!body.stream,
        }) + "\n");
      }

      // Queue exhausted: fail loudly. A false green is worse than a red test.
      if (!turn) {
        const err = { type: "error", error: { type: "mock_exhausted", message: `mock track "${track}" has no turn ${turnIndex}` } };
        if (logPath) appendFileSync(logPath, JSON.stringify({ type: "exhausted", req: reqIndex, track, turnIndex }) + "\n");
        res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify(err)); return;
      }
      counters[track] = turnIndex + 1;

      const msg = messageFromTurn(turn, body.model || "mock", reqIndex);
      if (logPath) appendFileSync(logPath, JSON.stringify({
        type: "response", req: reqIndex, stop_reason: msg.stop_reason,
        tool_use: msg.content.filter((b) => b.type === "tool_use").map((b) => ({ name: b.name, input: b.input })),
      }) + "\n");
      reqIndex++;

      if (body.stream) await writeStreaming(res, msg);
      else writeBlocking(res, msg);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ url: `http://127.0.0.1:${port}`, port, close: () => new Promise((r) => {
        // Force-destroy any lingering sockets before close; otherwise undici's
        // keep-alive/streaming connections keep libuv handles open and Windows
        // Node asserts UV_HANDLE_CLOSING on exit.
        server.closeAllConnections();
        server.close(r);
      }) });
    });
  });
}
