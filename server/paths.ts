// Where den keeps the files its panes and the Manager share, under DATA_DIR.
import { join } from "node:path";
import { DATA_DIR } from "./dataDir.ts";

// Outside any repo, so a notepad never ends up in a commit.
export const PROGRESS_DIR = join(DATA_DIR, "progress");

// The Manager pane's day (#46): den's digest, and the Today list it writes.
// One Manager at a time, so these aren't per group.
export const MANAGER_DIR = join(DATA_DIR, "manager");
/** The Manager pane's name, which is how other sessions see it (ListAgents). */
export const MANAGER_NAME = "Fox";
export const TODAY_PATH = join(MANAGER_DIR, "today.md");
export const DIGEST_PATH = join(MANAGER_DIR, "digest.md");
/** Open PRs as den last read them, for Fox to check before it presents one. */
export const PRS_PATH = join(MANAGER_DIR, "prs.md");
/** The sessions in the last digest, so the next one can say which are new. */
export const DIGEST_SESSIONS_PATH = join(MANAGER_DIR, "digest-sessions.json");
/** Where a pane saves the object a check returned, for den to show. */
export const CHECKS_DIR = join(DATA_DIR, "checks");
/** Bug buster: the scout workflow's last result, which Fox writes and the Bugs tab shows. */
export const BUGS_PATH = join(MANAGER_DIR, "bugs.json");
/** Bug sessions bug buster keeps going at once. */
export const BUG_SLOTS = 5;
/** Bug buster: the last ranked queue, kept so the Bugs tab survives a restart. */
export const BUG_QUEUE_PATH = join(MANAGER_DIR, "bug-queue.json");
