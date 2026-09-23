import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SESSION_DIR = join(homedir(), ".xycode", "sessions");

interface SessionMetadata {
  id: string;
  model: string;
  cwd: string;
  startTime: string;
  messageCount: number;
}

interface SessionData {
  metadata: SessionMetadata;
  anthropicMessages?: any[];
  openaiMessages?: any[];
}

function ensureDir() {
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
}

export function saveSession(
  id: string,
  data: Omit<SessionData, "metadata"> & { metadata: SessionMetadata }
): void {
  ensureDir();
  writeFileSync(join(SESSION_DIR, `${id}.json`), JSON.stringify(data, null, 2));
}

export function loadSession(id: string): SessionData | null {
  const file = join(SESSION_DIR, `${id}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

export function listSessions(): SessionMetadata[] {
  ensureDir();
  const files = readdirSync(SESSION_DIR).filter((f) => f.endsWith(".json"));
  return files
    .map((f) => {
      try {
        const data = JSON.parse(readFileSync(join(SESSION_DIR, f), "utf-8"));
        return data.metadata as SessionMetadata;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as SessionMetadata[];
}

export function getLatestSessionId(): string | null {
  const sessions = listSessions();
  if (sessions.length === 0) return null;
  sessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  return sessions[0].id;
}
