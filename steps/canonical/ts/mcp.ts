import { spawn } from "child_process";
import { createInterface } from "readline";

// A minimal MCP client: spawn the server as a subprocess and speak
// line-delimited JSON-RPC over its stdio — initialize, then discover its tools,
// then call them. Real MCP has more (multiple transports, auth); the stdio
// handshake is the essence, and it's how you plug external tools into the agent
// without changing its code.
export interface McpTool { name: string; description: string; input_schema: unknown; }
export interface McpConnection { tools: McpTool[]; callTool(name: string, args: unknown): Promise<string>; close(): void; }

//#region mcp
export async function connectMcp(command: string, args: string[]): Promise<McpConnection> {
  const proc = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
  const rl = createInterface({ input: proc.stdout! });
  let nextId = 1;
  const pending = new Map<number, (v: any) => void>();
  rl.on("line", (line) => {
    try { const msg = JSON.parse(line); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)!(msg); pending.delete(msg.id); } } catch {}
  });
  const request = (method: string, params?: unknown) =>
    new Promise<any>((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });

  await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "mini-claude", version: "1.0" } });
  proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const listed = await request("tools/list");
  const tools: McpTool[] = (listed.result?.tools || []).map((t: any) => ({ name: t.name, description: t.description || "", input_schema: t.inputSchema }));

  return {
    tools,
    async callTool(name, args) {
      const r = await request("tools/call", { name, arguments: args });
      const content = r.result?.content || [];
      return content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("") || JSON.stringify(r.result ?? r.error);
    },
    close() { proc.kill(); },
  };
}
//#endregion
