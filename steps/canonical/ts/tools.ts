import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { execSync, execFileSync } from "child_process";
import { glob } from "glob";
import { dirname, join } from "path";
import type Anthropic from "@anthropic-ai/sdk";

// A tool is three things: a name, a description the model reads, and a function
// that does the work. The definitions below are exactly the shape the API wants.
export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "Read the contents of a file. Returns the file content with line numbers.",
    input_schema: {
      type: "object",
      properties: { file_path: { type: "string", description: "The path to the file to read" } },
      required: ["file_path"],
    },
  },
//#step >=2
  {
    name: "write_file",
    description: "Write content to a file. Creates it if missing, overwrites if it exists.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "The path to the file to write" },
        content: { type: "string", description: "The content to write" },
      },
      required: ["file_path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace an exact string in a file with new content. old_string must match exactly and be unique.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "The path to the file to edit" },
        old_string: { type: "string", description: "The exact string to find" },
        new_string: { type: "string", description: "The string to replace it with" },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  },
  {
    name: "list_files",
    description: "List files matching a glob pattern (e.g. \"**/*.ts\").",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern to match files" },
        path: { type: "string", description: "Base directory. Defaults to cwd." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "grep_search",
    description: "Search for a regex pattern in files. Returns matching lines with paths and line numbers.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "The regex pattern to search for" },
        path: { type: "string", description: "Directory or file to search. Defaults to cwd." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "run_shell",
    description: "Execute a shell command and return its output. For tests, git, package installs, etc.",
    input_schema: {
      type: "object",
      properties: { command: { type: "string", description: "The shell command to execute" } },
      required: ["command"],
    },
  },
//#endstep
//#step >=11
  {
    name: "agent",
    description: "Delegate a read-only investigation to a sub-agent. Give it a task; it explores on its own and reports back a summary.",
    input_schema: {
      type: "object",
      properties: { task: { type: "string", description: "The task for the sub-agent to investigate" } },
      required: ["task"],
    },
  },
//#endstep
];

// Dispatch a tool call by name. Unknown names return an error string instead of
// throwing, so a hallucinated tool name lets the model self-correct.
//#region dispatch
export async function executeTool(name: string, input: Record<string, any>): Promise<string> {
  switch (name) {
    case "read_file": return readFile(input as { file_path: string });
//#step >=2
    case "write_file": return writeFile(input as { file_path: string; content: string });
    case "edit_file": return editFile(input as { file_path: string; old_string: string; new_string: string });
    case "list_files": return listFiles(input as { pattern: string; path?: string });
    case "grep_search": return grepSearch(input as { pattern: string; path?: string });
    case "run_shell": return runShell(input as { command: string });
//#endstep
    default: return `Unknown tool: ${name}`;
  }
}
//#endregion

//#region read_file
function readFile(input: { file_path: string }): string {
  try {
    const lines = readFileSync(input.file_path, "utf-8").split("\n");
    return lines.map((l, i) => `${String(i + 1).padStart(4)} | ${l}`).join("\n");
  } catch (e: any) {
    return `Error reading file: ${e.message}`;
  }
}
//#endregion

//#step >=2
function writeFile(input: { file_path: string; content: string }): string {
  try {
    const dir = dirname(input.file_path);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(input.file_path, input.content);
    const n = input.content.split("\n").length;
    return `Successfully wrote to ${input.file_path} (${n} lines)`;
  } catch (e: any) {
    return `Error writing file: ${e.message}`;
  }
}

// edit_file is the one tool with a real trap: the match must be unique, or you
// edit the wrong place. So we count occurrences and refuse if it isn't unique.
//#region edit_file
function editFile(input: { file_path: string; old_string: string; new_string: string }): string {
  try {
    const content = readFileSync(input.file_path, "utf-8");
    if (!content.includes(input.old_string)) {
      return `Error: old_string not found in ${input.file_path}`;
    }
    const count = content.split(input.old_string).length - 1;
    if (count > 1) {
      return `Error: old_string found ${count} times in ${input.file_path}. Must be unique.`;
    }
    // split/join avoids $-substitution surprises from String.replace.
    const updated = content.split(input.old_string).join(input.new_string);
    writeFileSync(input.file_path, updated);
    return `Successfully edited ${input.file_path}`;
  } catch (e: any) {
    return `Error editing file: ${e.message}`;
  }
}
//#endregion

async function listFiles(input: { pattern: string; path?: string }): Promise<string> {
  try {
    const files = await glob(input.pattern, {
      cwd: input.path || process.cwd(),
      nodir: true,
      ignore: ["node_modules/**", ".git/**"],
    });
    if (files.length === 0) return "No files found matching the pattern.";
    return files.slice(0, 200).join("\n");
  } catch (e: any) {
    return `Error listing files: ${e.message}`;
  }
}

function grepSearch(input: { pattern: string; path?: string }): string {
  // Prefer the system grep; fall back to a tiny JS walker if it isn't there.
  try {
    const out = execFileSync("grep", ["--line-number", "--color=never", "-r", "--", input.pattern, input.path || "."], {
      encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, timeout: 10000,
    });
    return out.split("\n").filter(Boolean).slice(0, 100).join("\n") || "No matches found.";
  } catch (e: any) {
    if (e.status === 1) return "No matches found.";
    return grepJS(input.pattern, input.path || ".");
  }
}

function grepJS(pattern: string, dir: string): string {
  let re: RegExp;
  try { re = new RegExp(pattern); } catch (e: any) { return `Error: invalid regex: ${e.message}`; }
  const matches: string[] = [];
  const walk = (d: string) => {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const full = join(d, name);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      try {
        readFileSync(full, "utf-8").split("\n").forEach((line, i) => {
          if (re.test(line) && matches.length < 100) matches.push(`${full}:${i + 1}:${line}`);
        });
      } catch {}
    }
  };
  walk(dir);
  return matches.length ? matches.join("\n") : "No matches found.";
}

function runShell(input: { command: string }): string {
  try {
    return execSync(input.command, {
      encoding: "utf-8", maxBuffer: 5 * 1024 * 1024, timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"], shell: "/bin/sh",
    }) || "(no output)";
  } catch (e: any) {
    return `Command failed (exit ${e.status})${e.stdout ? `\nStdout: ${e.stdout}` : ""}${e.stderr ? `\nStderr: ${e.stderr}` : ""}`;
  }
}
//#endstep
