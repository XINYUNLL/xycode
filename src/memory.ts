// Memory system — 4-type file-based memory with MEMORY.md index.
// Mirrors Claude Code's memory architecture: semantic recall via sideQuery.

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync,
  unlinkSync, statSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { parseFrontmatter, formatFrontmatter } from "./frontmatter.js";
import { execFileSync } from "child_process";

/** A function that sends a prompt and returns the model's text response. */
export type SideQueryFn = (system: string, userMessage: string, signal?: AbortSignal) => Promise<string>;

// ─── Types ──────────────────────────────────────────────────

export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryEntry {
  name: string;
  description: string;
  type: MemoryType;
  filename: string;
  content: string;
}

const VALID_TYPES = new Set<MemoryType>(["user", "feedback", "project", "reference"]);
const MAX_INDEX_LINES = 200;
const MAX_INDEX_BYTES = 25000;

// ─── Paths ──────────────────────────────────────────────────

function getProjectHash(): string {
  return createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16);
}

export function getMemoryDir(): string {
  const dir = join(homedir(), ".xycode", "projects", getProjectHash(), "memory");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getIndexPath(): string {
  return join(getMemoryDir(), "MEMORY.md");
}

// ─── Slugify ────────────────────────────────────────────────

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  // Non-Latin names (e.g. Chinese) slugify to empty — fall back to a hash so
  // two Chinese memories don't collide on the same filename.
  if (slug) return slug;
  return createHash("sha1").update(text).digest("hex").slice(0, 8);
}

// ─── CRUD ───────────────────────────────────────────────────

export function listMemories(): MemoryEntry[] {
  const dir = getMemoryDir();
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".md") && f !== "MEMORY.md"
  );
  const entries: MemoryEntry[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), "utf-8");
      const { meta, body } = parseFrontmatter(raw);
      if (!meta.name || !meta.type) continue;
      entries.push({
        name: meta.name,
        description: meta.description || "",
        type: (VALID_TYPES.has(meta.type as MemoryType) ? meta.type : "project") as MemoryType,
        filename: file,
        content: body,
      });
    } catch { /* skip corrupt files */ }
  }
  // Sort by mtime desc
  entries.sort((a, b) => {
    try {
      const statA = statSync(join(dir, a.filename));
      const statB = statSync(join(dir, b.filename));
      return statB.mtimeMs - statA.mtimeMs;
    } catch { return 0; }
  });
  return entries;
}

export function saveMemory(entry: Omit<MemoryEntry, "filename">): string {
  const dir = getMemoryDir();
  const filename = `${entry.type}_${slugify(entry.name)}.md`;
  const content = formatFrontmatter(
    { name: entry.name, description: entry.description, type: entry.type },
    entry.content
  );
  writeFileSync(join(dir, filename), content);
  updateMemoryIndex();
  // Compute + store the embedding for semantic recall (best-effort).
  const vec = embedText(`${entry.name} ${entry.description} ${entry.content}`);
  if (vec) {
    const embeddings = loadEmbeddings();
    embeddings[filename] = vec;
    saveEmbeddings(embeddings);
  }
  return filename;
}

export function deleteMemory(filename: string): boolean {
  const filepath = join(getMemoryDir(), filename);
  if (!existsSync(filepath)) return false;
  unlinkSync(filepath);
  updateMemoryIndex();
  // Remove the stored embedding (best-effort).
  const embeddings = loadEmbeddings();
  if (filename in embeddings) {
    delete embeddings[filename];
    saveEmbeddings(embeddings);
  }
  return true;
}

// ─── Local Embedding (semantic memory) ───────────────────────
// Uses a local bge-small-zh model via a small Python script. Configure with
// XYCODE_EMBED_PYTHON (python executable) and XYCODE_EMBED_SCRIPT (path to
// embed.py). If XYCODE_EMBED_SCRIPT is unset, embedding recall is disabled
// and the model-based sideQuery remains the only recall path.

const EMBED_PYTHON = process.env.XYCODE_EMBED_PYTHON || "python";
const EMBED_SCRIPT = process.env.XYCODE_EMBED_SCRIPT || "";

function getEmbeddingsPath(): string {
  return join(getMemoryDir(), "embeddings.json");
}

function loadEmbeddings(): Record<string, number[]> {
  const p = getEmbeddingsPath();
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return {}; }
}

function saveEmbeddings(map: Record<string, number[]>): void {
  writeFileSync(getEmbeddingsPath(), JSON.stringify(map));
}

/** Embed text → vector, or null if embedding isn't configured / fails. */
function embedText(text: string): number[] | null {
  if (!EMBED_SCRIPT) return null;
  try {
    const out = execFileSync(EMBED_PYTHON, [EMBED_SCRIPT, text], {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(out.trim());
  } catch (err: any) {
    console.error(`[memory] embedding failed: ${err.message}`);
    return null;
  }
}

/** Cosine similarity. embed.py normalizes vectors, so dot product == cosine. */
function cosineSimilarity(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ─── Index ──────────────────────────────────────────────────

function updateMemoryIndex(): void {
  const memories = listMemories();
  const lines = ["# Memory Index", ""];
  for (const m of memories) {
    lines.push(`- **[${m.name}](${m.filename})** (${m.type}) — ${m.description}`);
  }
  writeFileSync(getIndexPath(), lines.join("\n"));
}

export function loadMemoryIndex(): string {
  const indexPath = getIndexPath();
  if (!existsSync(indexPath)) return "";
  let content = readFileSync(indexPath, "utf-8");
  // Truncate to limits (matching Claude Code: 200 lines, 25KB)
  const lines = content.split("\n");
  if (lines.length > MAX_INDEX_LINES) {
    content = lines.slice(0, MAX_INDEX_LINES).join("\n") +
      "\n\n[... truncated, too many memory entries ...]";
  }
  if (Buffer.byteLength(content) > MAX_INDEX_BYTES) {
    content = content.slice(0, MAX_INDEX_BYTES) +
      "\n\n[... truncated, index too large ...]";
  }
  return content;
}

// ─── Memory Header (lightweight scan) ──────────────────────

export interface MemoryHeader {
  filename: string;
  filePath: string;
  mtimeMs: number;
  description: string | null;
  type: MemoryType | undefined;
}

const MAX_MEMORY_FILES = 200;
const MAX_MEMORY_BYTES_PER_FILE = 4096;
const MAX_SESSION_MEMORY_BYTES = 60 * 1024; // 60KB cumulative per session

/** Scan memory directory — read only frontmatter (first 30 lines) for speed. */
export function scanMemoryHeaders(): MemoryHeader[] {
  const dir = getMemoryDir();
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".md") && f !== "MEMORY.md"
  );
  const headers: MemoryHeader[] = [];
  for (const file of files) {
    try {
      const filePath = join(dir, file);
      const stat = statSync(filePath);
      const raw = readFileSync(filePath, "utf-8");
      // Only parse frontmatter (first 30 lines)
      const first30 = raw.split("\n").slice(0, 30).join("\n");
      const { meta } = parseFrontmatter(first30);
      headers.push({
        filename: file,
        filePath,
        mtimeMs: stat.mtimeMs,
        description: meta.description || null,
        type: VALID_TYPES.has(meta.type as MemoryType) ? (meta.type as MemoryType) : undefined,
      });
    } catch { /* skip corrupt files */ }
  }
  // Sort newest first, cap at 200
  headers.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return headers.slice(0, MAX_MEMORY_FILES);
}

/** Format manifest for semantic selector: one line per memory. */
export function formatMemoryManifest(headers: MemoryHeader[]): string {
  return headers
    .map((h) => {
      const tag = h.type ? `[${h.type}] ` : "";
      const ts = new Date(h.mtimeMs).toISOString();
      return h.description
        ? `- ${tag}${h.filename} (${ts}): ${h.description}`
        : `- ${tag}${h.filename} (${ts})`;
    })
    .join("\n");
}

// ─── Memory Age / Freshness ────────────────────────────────

export function memoryAge(mtimeMs: number): string {
  const days = Math.max(0, Math.floor((Date.now() - mtimeMs) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function memoryFreshnessWarning(mtimeMs: number): string {
  const days = Math.max(0, Math.floor((Date.now() - mtimeMs) / 86_400_000));
  if (days <= 1) return "";
  return `This memory is ${days} days old. Memories are point-in-time observations, not live state — claims about code behavior may be outdated. Verify against current code before asserting as fact.`;
}

// ─── Semantic Recall (sideQuery) ────────────────────────────

const SELECT_MEMORIES_PROMPT = `You are selecting memories that will be useful to an AI coding assistant as it processes a user's query. You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return a JSON object with a "selected_memories" array of filenames for the memories that will clearly be useful (up to 5). Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful, do not include it.
- If no memories would clearly be useful, return an empty array.`;

export interface RelevantMemory {
  path: string;
  content: string;
  mtimeMs: number;
  header: string;
}

/**
 * Call the model to semantically select relevant memories.
 * Uses the same model the user configured (not a separate small model).
 */
export async function selectRelevantMemories(
  query: string,
  sideQuery: SideQueryFn,
  alreadySurfaced: Set<string>,
  signal?: AbortSignal,
): Promise<RelevantMemory[]> {
  const headers = scanMemoryHeaders();
  if (headers.length === 0) return [];

  // Filter out already-surfaced memories before sending to selector
  const candidates = headers.filter((h) => !alreadySurfaced.has(h.filePath));
  if (candidates.length === 0) return [];

  const manifest = formatMemoryManifest(candidates);

  try {
    const text = await sideQuery(
      SELECT_MEMORIES_PROMPT,
      `Query: ${query}\n\nAvailable memories:\n${manifest}`,
      signal,
    );

    // Extract JSON from response (model might wrap in markdown code block)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    const selectedFilenames: string[] = parsed.selected_memories || [];

    // Map filenames back to headers, read full content
    const filenameSet = new Set(selectedFilenames);
    const selected = candidates.filter((h) => filenameSet.has(h.filename));

    return selected.slice(0, 5).map((h) => {
      let content = readFileSync(h.filePath, "utf-8");
      // Truncate to per-file limit
      if (Buffer.byteLength(content) > MAX_MEMORY_BYTES_PER_FILE) {
        content = content.slice(0, MAX_MEMORY_BYTES_PER_FILE) +
          "\n\n[... truncated, memory file too large ...]";
      }
      const freshness = memoryFreshnessWarning(h.mtimeMs);
      const headerText = freshness
        ? `${freshness}\n\nMemory: ${h.filePath}:`
        : `Memory (saved ${memoryAge(h.mtimeMs)}): ${h.filePath}:`;

      return { path: h.filePath, content, mtimeMs: h.mtimeMs, header: headerText };
    });
  } catch (err: any) {
    // Silently fail — memory recall should never block the main loop
    if (signal?.aborted) return [];
    console.error(`[memory] semantic recall failed: ${err.message}`);
    return [];
  }
}

/**
 * Select relevant memories by embedding similarity (cosine). Cheaper than the
 * model-based sideQuery and works offline. Returns [] if embeddings aren't
 * configured or nothing is similar enough.
 */
export function selectRelevantMemoriesByEmbedding(
  query: string,
  alreadySurfaced: Set<string>,
): RelevantMemory[] {
  const queryVec = embedText(query);
  if (!queryVec) return [];

  const embeddings = loadEmbeddings();
  const memories = listMemories();

  const scored: { m: MemoryEntry; score: number }[] = [];
  for (const m of memories) {
    if (alreadySurfaced.has(m.filename)) continue;
    const vec = embeddings[m.filename];
    if (!vec) continue;
    scored.push({ m, score: cosineSimilarity(queryVec, vec) });
  }
  scored.sort((a, b) => b.score - a.score);

  // Top-K with a minimum similarity threshold (normalized cosine in [-1, 1]).
  return scored
    .slice(0, 5)
    .filter((s) => s.score > 0.35)
    .map((s) => {
      const m = s.m;
      let mtimeMs = 0;
      try { mtimeMs = statSync(join(getMemoryDir(), m.filename)).mtimeMs; } catch {}
      return {
        path: m.filename,
        content: m.content,
        mtimeMs,
        header: `Memory (${memoryAge(mtimeMs)}): ${m.filename}:`,
      };
    });
}

// ─── Prefetch Handle ────────────────────────────────────────

export interface MemoryPrefetch {
  promise: Promise<RelevantMemory[]>;
  settled: boolean;
  consumed: boolean;
}

/**
 * Start async memory prefetch. Returns a handle to poll for results.
 * Gate conditions (matching Claude Code):
 *   - Input must have multiple words
 *   - Session memory budget not exceeded
 */
/** Check if query contains enough meaningful content (CJK chars or multi-word). */
function isQuerySubstantial(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) return false;
  
  // Check for CJK characters (Chinese, Japanese, Korean)
  const cjkRegex = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;
  const cjkMatches = trimmed.match(cjkRegex);
  if (cjkMatches && cjkMatches.length >= 2) return true;
  
  // Fallback: multi-word input (contains whitespace)
  if (/\s/.test(trimmed)) return true;
  
  return false;
}

export function startMemoryPrefetch(
  query: string,
  sideQuery: SideQueryFn,
  alreadySurfaced: Set<string>,
  sessionMemoryBytes: number,
  signal?: AbortSignal,
): MemoryPrefetch | null {
  // Gate: substantial input (CJK chars or multi-word)
  if (!isQuerySubstantial(query)) return null;

  // Gate: session budget
  if (sessionMemoryBytes >= MAX_SESSION_MEMORY_BYTES) return null;

  // Gate: memories must exist
  const dir = getMemoryDir();
  const hasMemories = readdirSync(dir).some(
    (f) => f.endsWith(".md") && f !== "MEMORY.md"
  );
  if (!hasMemories) return null;

  const handle: MemoryPrefetch = {
    promise: (async () => {
      // Hybrid recall: embedding similarity first (cheap, offline), fall back
      // to the model-based sideQuery when embeddings aren't configured or
      // nothing is similar enough.
      const embedded = selectRelevantMemoriesByEmbedding(query, alreadySurfaced);
      if (embedded.length > 0) return embedded;
      return selectRelevantMemories(query, sideQuery, alreadySurfaced, signal);
    })(),
    settled: false,
    consumed: false,
  };
  handle.promise.then(() => { handle.settled = true; }).catch(() => { handle.settled = true; });
  return handle;
}

/** Format recalled memories for injection as user message content. */
export function formatMemoriesForInjection(memories: RelevantMemory[]): string {
  return memories
    .map((m) => `<system-reminder>\n${m.header}\n\n${m.content}\n</system-reminder>`)
    .join("\n\n");
}

// ─── System prompt section ──────────────────────────────────

export function buildMemoryPromptSection(): string {
  const index = loadMemoryIndex();
  const memoryDir = getMemoryDir();

  return `# Memory System

You have a persistent, file-based memory system at \`${memoryDir}\`.

## Memory Types
- **user**: User's role, preferences, knowledge level
- **feedback**: Corrections and guidance from the user (include Why + How to apply)
- **project**: Ongoing work, goals, deadlines, decisions
- **reference**: Pointers to external resources (URLs, tools, dashboards)

## How to Save Memories
Use the write_file tool to create a memory file with YAML frontmatter:

\`\`\`markdown
---
name: memory name
description: one-line description
type: user|feedback|project|reference
---
Memory content here.
\`\`\`

Save to: \`${memoryDir}/\`
Filename format: \`{type}_{slugified_name}.md\`

The MEMORY.md index is auto-updated when you write to the memory directory — do NOT update it manually.

## What NOT to Save
- Code patterns or architecture (read the code instead)
- Git history (use git log)
- Anything already in CLAUDE.md
- Ephemeral task details

## When to Recall
When the user asks you to remember or recall, or when prior context seems relevant.
${index ? `\n## Current Memory Index\n${index}` : "\n(No memories saved yet.)"}`;
}
