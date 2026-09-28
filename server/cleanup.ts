// The rail's clean-up button (#29): which personal Claude Code skill it asks
// the session to use. The procedure itself lives in that skill, outside den:
// den is public, and the steps depend on one person's tooling (container
// runtime, stack CLI, merge style). Den only names the skill.
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { store } from "./store.ts";

const SKILLS_DIR = join(homedir(), ".claude", "skills");
const SETTING = "cleanup_skill";

/** A skill name as Claude Code's skill directories use them. */
export function isValidSkillName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(name);
}

/** Pick the clean-up skill: $DEN_CLEANUP_SKILL, then the `cleanup_skill`
 * setting, then the one installed skill named `cleanup` or `*-cleanup`.
 * Null when there's no single answer; the button then sends a generic
 * prompt. Pure (the directory listing is passed in), for the test. */
export function pickCleanupSkill(
  configured: (string | null | undefined)[],
  installed: string[],
): string | null {
  for (const c of configured) {
    const name = c?.trim();
    if (name && isValidSkillName(name) && installed.includes(name)) return name;
  }
  const matches = installed.filter((n) => isValidSkillName(n) && (n === "cleanup" || n.endsWith("-cleanup")));
  return matches.length === 1 ? matches[0] : null;
}

/** Installed personal skills: directories in ~/.claude/skills with a SKILL.md. */
function installedSkills(): string[] {
  try {
    return readdirSync(SKILLS_DIR).filter((d) => existsSync(join(SKILLS_DIR, d, "SKILL.md")));
  } catch {
    return [];
  }
}

export function cleanupSkill(): string | null {
  return pickCleanupSkill([process.env.DEN_CLEANUP_SKILL, store.getSetting(SETTING)], installedSkills());
}
