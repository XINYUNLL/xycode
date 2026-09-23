import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// The session is just the message array on disk. Save after every turn; load it
// back on --resume. No database — the whole conversation is already a plain array.
const SESSION_FILE = join(process.cwd(), ".mini-session.json");

//#region session
export function saveSession(messages: unknown[]): void {
  try { writeFileSync(SESSION_FILE, JSON.stringify(messages, null, 2)); } catch {}
}

export function loadSession(): unknown[] | null {
  if (!existsSync(SESSION_FILE)) return null;
  try { return JSON.parse(readFileSync(SESSION_FILE, "utf-8")); } catch { return null; }
}
//#endregion
