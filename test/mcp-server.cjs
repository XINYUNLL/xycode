#!/usr/bin/env node
// Minimal MCP server over stdio for testing
// Implements JSON-RPC 2.0: initialize, tools/list, tools/call

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });

const TOOLS = [
  {
    name: "echo",
    description: "Echoes back the input text",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to echo" } },
      required: ["text"]
    }
  },
  {
    name: "add",
    description: "Adds two numbers together",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number", description: "First number" },
        b: { type: "number", description: "Second number" }
      },
      required: ["a", "b"]
    }
  },
  {
    name: "timestamp",
    description: "Returns the current Unix timestamp",
    inputSchema: { type: "object", properties: {} }
  }
];

function handleRequest(req) {
  const { method, params, id } = req;

  if (method === "initialize") {
    return { jsonrpc: "2.0", id, result: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "test-mcp-server", version: "1.0.0" }
    }};
  }
  if (method === "notifications/initialized") return null;

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }

  if (method === "tools/call") {
    const args = params.arguments || {};
    switch (params.name) {
      case "echo":
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: args.text || "(empty)" }] } };
      case "add":
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `${(args.a||0) + (args.b||0)}` }] } };
      case "timestamp":
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `${Date.now()}` }] } };
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${params.name}` } };
    }
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } };
}

rl.on('line', (line) => {
  try {
    const resp = handleRequest(JSON.parse(line.trim()));
    if (resp) process.stdout.write(JSON.stringify(resp) + '\n');
  } catch {}
});
