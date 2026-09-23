import json
import subprocess
import threading

# A minimal MCP client: spawn the server as a subprocess and speak
# line-delimited JSON-RPC over its stdio — initialize, then discover its tools,
# then call them. Real MCP has more (multiple transports, auth); the stdio
# handshake is the essence, and it's how you plug external tools into the agent
# without changing its code.


#region mcp
class McpConnection:
    def __init__(self, command, args):
        self.proc = subprocess.Popen([command, *args], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, text=True, bufsize=1)
        self._id = 0
        self._lock = threading.Lock()

    def _request(self, method, params=None):
        with self._lock:
            self._id += 1
            rid = self._id
            self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}}) + "\n")
            self.proc.stdin.flush()
            while True:
                line = self.proc.stdout.readline()
                if not line:
                    return {}
                msg = json.loads(line)
                if msg.get("id") == rid:
                    return msg

    def _notify(self, method):
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": method}) + "\n")
        self.proc.stdin.flush()

    def connect(self):
        self._request("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "mini-claude", "version": "1.0"}})
        self._notify("notifications/initialized")
        listed = self._request("tools/list")
        self.tools = [{"name": t["name"], "description": t.get("description", ""), "input_schema": t.get("inputSchema")}
                      for t in listed.get("result", {}).get("tools", [])]
        return self

    def call_tool(self, name, args):
        r = self._request("tools/call", {"name": name, "arguments": args})
        content = r.get("result", {}).get("content", [])
        text = "".join(c.get("text", "") for c in content if c.get("type") == "text")
        return text or json.dumps(r.get("result") or r.get("error"))

    def close(self):
        self.proc.terminate()


def connect_mcp(command, args):
    return McpConnection(command, args).connect()
#endregion
