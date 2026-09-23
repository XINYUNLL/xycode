import os
import platform
import subprocess

# The static core: identity, rules, and tool preferences. Byte-identical across
# sessions, which is exactly what makes it cacheable (a real agent marks this
# block with cache_control).
#region static_core
STATIC_CORE = """You are Mini Claude Code, a small coding assistant CLI.
You help with software engineering tasks using the tools available to you.

# Doing tasks
 - Do not propose changes to code you haven't read. Read files first.
 - Do not create files unless necessary. Prefer editing existing files.
 - Avoid over-engineering. Only make changes that were requested.

# Executing actions with care
 - Prefer reversible actions. For risky or destructive ones (rm -rf, git push,
   dropping tables), confirm with the user before proceeding.

# Using your tools
 - Use read_file / edit_file / list_files / grep_search instead of shell cat,
   sed, ls, grep. Reserve run_shell for actual shell operations.
 - If several tool calls are independent, make them in parallel.

# Tone and style
 - Keep responses short and concise. Lead with the answer.
 - Reference code as file_path:line_number."""
#endregion


# The dynamic half: environment facts assembled fresh each run. Kept separate
# from the static core so it never pollutes the cache.
def _environment_context() -> str:
    git = ""
    try:
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=3,
        ).stdout.strip()
        if branch:
            git = f"\nGit branch: {branch}"
    except Exception:
        pass
    return (
        "# Environment\n"
        f"Working directory: {os.getcwd()}\n"
        f"Platform: {platform.system()} {platform.machine()}\n"
        f"Shell: {os.environ.get('SHELL', '/bin/sh')}{git}"
    )


# Static core first, then the environment block.
def build_system_prompt() -> str:
    return f"{STATIC_CORE}\n\n{_environment_context()}"
