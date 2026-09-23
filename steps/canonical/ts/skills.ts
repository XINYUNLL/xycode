import { readFileSync, existsSync } from "fs";
import { join } from "path";

// A skill is a reusable prompt template in .mini-skills/<name>.md. Typing
// "/commit ..." loads it and runs its prompt (with any extra text appended) as
// if you'd typed the whole thing — install-and-use like a shell script.
const SKILLS_DIR = join(process.cwd(), ".mini-skills");

//#region skill
export function resolveSkill(input: string): string | null {
  if (!input.startsWith("/")) return null;
  const [name, ...rest] = input.slice(1).split(" ");
  const file = join(SKILLS_DIR, `${name}.md`);
  if (!existsSync(file)) return null;
  const prompt = readFileSync(file, "utf-8").trim();
  const args = rest.join(" ").trim();
  return args ? `${prompt}\n\n${args}` : prompt;
}
//#endregion
