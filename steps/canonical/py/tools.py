import os
import re
import subprocess

# A tool is three things: a name, a description the model reads, and a function
# that does the work. The definitions below are exactly the shape the API wants.
tool_definitions = [
    {
        "name": "read_file",
        "description": "Read the contents of a file. Returns the file content with line numbers.",
        "input_schema": {
            "type": "object",
            "properties": {"file_path": {"type": "string", "description": "The path to the file to read"}},
            "required": ["file_path"],
        },
    },
#step >=2
    {
        "name": "write_file",
        "description": "Write content to a file. Creates it if missing, overwrites if it exists.",
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {"type": "string", "description": "The path to the file to write"},
                "content": {"type": "string", "description": "The content to write"},
            },
            "required": ["file_path", "content"],
        },
    },
    {
        "name": "edit_file",
        "description": "Replace an exact string in a file with new content. old_string must match exactly and be unique.",
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {"type": "string", "description": "The path to the file to edit"},
                "old_string": {"type": "string", "description": "The exact string to find"},
                "new_string": {"type": "string", "description": "The string to replace it with"},
            },
            "required": ["file_path", "old_string", "new_string"],
        },
    },
    {
        "name": "list_files",
        "description": "List files matching a glob pattern (e.g. \"**/*.py\").",
        "input_schema": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string", "description": "Glob pattern to match files"},
                "path": {"type": "string", "description": "Base directory. Defaults to cwd."},
            },
            "required": ["pattern"],
        },
    },
    {
        "name": "grep_search",
        "description": "Search for a regex pattern in files. Returns matching lines with paths and line numbers.",
        "input_schema": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string", "description": "The regex pattern to search for"},
                "path": {"type": "string", "description": "Directory or file to search. Defaults to cwd."},
            },
            "required": ["pattern"],
        },
    },
    {
        "name": "run_shell",
        "description": "Execute a shell command and return its output. For tests, git, package installs, etc.",
        "input_schema": {
            "type": "object",
            "properties": {"command": {"type": "string", "description": "The shell command to execute"}},
            "required": ["command"],
        },
    },
#endstep
#step >=11
    {
        "name": "agent",
        "description": "Delegate a read-only investigation to a sub-agent. Give it a task; it explores on its own and reports back a summary.",
        "input_schema": {
            "type": "object",
            "properties": {"task": {"type": "string", "description": "The task for the sub-agent to investigate"}},
            "required": ["task"],
        },
    },
#endstep
]


# Dispatch a tool call by name. Unknown names return an error string instead of
# raising, so a hallucinated tool name lets the model self-correct.
#region dispatch
def execute_tool(name: str, inp: dict) -> str:
    if name == "read_file":
        return _read_file(inp)
#step >=2
    if name == "write_file":
        return _write_file(inp)
    if name == "edit_file":
        return _edit_file(inp)
    if name == "list_files":
        return _list_files(inp)
    if name == "grep_search":
        return _grep_search(inp)
    if name == "run_shell":
        return _run_shell(inp)
#endstep
    return f"Unknown tool: {name}"
#endregion


#region read_file
def _read_file(inp: dict) -> str:
    try:
        lines = open(inp["file_path"], encoding="utf-8").read().split("\n")
        return "\n".join(f"{i + 1:4d} | {line}" for i, line in enumerate(lines))
    except Exception as e:
        return f"Error reading file: {e}"
#endregion


#step >=2
def _write_file(inp: dict) -> str:
    try:
        d = os.path.dirname(inp["file_path"])
        if d and not os.path.exists(d):
            os.makedirs(d, exist_ok=True)
        with open(inp["file_path"], "w", encoding="utf-8") as f:
            f.write(inp["content"])
        n = len(inp["content"].split("\n"))
        return f"Successfully wrote to {inp['file_path']} ({n} lines)"
    except Exception as e:
        return f"Error writing file: {e}"


# edit_file is the one tool with a real trap: the match must be unique, or you
# edit the wrong place. So we count occurrences and refuse if it isn't unique.
#region edit_file
def _edit_file(inp: dict) -> str:
    try:
        content = open(inp["file_path"], encoding="utf-8").read()
        if inp["old_string"] not in content:
            return f"Error: old_string not found in {inp['file_path']}"
        count = content.count(inp["old_string"])
        if count > 1:
            return f"Error: old_string found {count} times in {inp['file_path']}. Must be unique."
        updated = content.replace(inp["old_string"], inp["new_string"])
        with open(inp["file_path"], "w", encoding="utf-8") as f:
            f.write(updated)
        return f"Successfully edited {inp['file_path']}"
    except Exception as e:
        return f"Error editing file: {e}"
#endregion


def _list_files(inp: dict) -> str:
    import glob as globmod

    try:
        base = inp.get("path") or "."
        hits = [
            f for f in globmod.glob(os.path.join(base, inp["pattern"]), recursive=True)
            if os.path.isfile(f) and "node_modules" not in f and "/.git/" not in f
        ]
        return "\n".join(hits[:200]) if hits else "No files found matching the pattern."
    except Exception as e:
        return f"Error listing files: {e}"


def _grep_search(inp: dict) -> str:
    # Prefer the system grep; fall back to a tiny Python walker if it isn't there.
    try:
        out = subprocess.run(
            ["grep", "--line-number", "--color=never", "-r", "--", inp["pattern"], inp.get("path") or "."],
            capture_output=True, text=True, timeout=10,
        )
        if out.returncode == 1:
            return "No matches found."
        lines = [ln for ln in out.stdout.split("\n") if ln]
        return "\n".join(lines[:100]) if lines else "No matches found."
    except FileNotFoundError:
        return _grep_py(inp["pattern"], inp.get("path") or ".")
    except Exception as e:
        return f"Error: {e}"


def _grep_py(pattern: str, base: str) -> str:
    try:
        rx = re.compile(pattern)
    except re.error as e:
        return f"Error: invalid regex: {e}"
    matches: list[str] = []
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d != "node_modules"]
        for name in files:
            full = os.path.join(root, name)
            try:
                for i, line in enumerate(open(full, encoding="utf-8"), 1):
                    if rx.search(line) and len(matches) < 100:
                        matches.append(f"{full}:{i}:{line.rstrip()}")
            except Exception:
                pass
    return "\n".join(matches) if matches else "No matches found."


def _run_shell(inp: dict) -> str:
    try:
        r = subprocess.run(inp["command"], shell=True, capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            return f"Command failed (exit {r.returncode})\nStdout: {r.stdout}\nStderr: {r.stderr}"
        return r.stdout or "(no output)"
    except subprocess.TimeoutExpired:
        return "Command timed out after 30000ms"
    except Exception as e:
        return f"Error: {e}"
#endstep
