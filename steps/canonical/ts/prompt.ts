import { execSync } from "child_process";
import * as os from "os";

// The static core: identity, rules, and tool preferences. Byte-identical across
// sessions, which is exactly what makes it cacheable (a real agent marks this
// block with cache_control).
//#region static_core
const STATIC_CORE = `You are Mini Claude Code, a small coding assistant CLI.
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
 - Reference code as file_path:line_number.`;
//#endregion

// The dynamic half: environment facts assembled fresh each run. Kept separate
// from the static core so it never pollutes the cache.
function buildEnvironmentContext(): string {
  let git = "";
  try {
    const opts = { encoding: "utf-8" as const, timeout: 3000, stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"] };
    const branch = execSync("git rev-parse --abbrev-ref HEAD", opts).trim();
    git = `\nGit branch: ${branch}`;
  } catch {}
  return `# Environment
Working directory: ${process.cwd()}
Platform: ${os.platform()} ${os.arch()}
Shell: ${process.env.SHELL || "/bin/sh"}${git}`;
}

// Static core first, then the environment block.
export function buildSystemPrompt(): string {
  return `${STATIC_CORE}\n\n${buildEnvironmentContext()}`;
}
