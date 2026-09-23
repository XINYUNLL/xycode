import re

# A tiny permission gate: dangerous shell commands are blocked, everything else
# runs. The real Claude Code has modes (ask / accept-edits / yolo) and layered
# rules; here we keep just the essential idea — check before you run.
#region permissions
_DANGEROUS = [
    r"\brm\s+-rf\b",
    r"\bgit\s+push\b",
    r"\bgit\s+reset\s+--hard\b",
    r"\bsudo\b",
    r"\bmkfs\b",
    r">\s*/dev/",
]


def check_permission(name: str, inp: dict) -> str:
    if name == "run_shell" and any(re.search(p, str(inp.get("command", ""))) for p in _DANGEROUS):
        return "deny"
    return "allow"
#endregion
