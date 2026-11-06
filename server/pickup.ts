import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TeamPr } from "./github.ts";
import { DATA_DIR } from "./dataDir.ts";

/** Fox's notes on the work panel's Open PRs for review: which of them tanuki
 * read and found easy to approve. den lists the PRs itself; Fox only marks
 * them, keyed "<repo>#<number>". */
export const PICKUP_NOTES_PATH = join(DATA_DIR, "manager", "review-pickup.json");

export interface PickNote {
  easy?: boolean;
  why?: string;
}

export type OpenReviewPr = TeamPr & PickNote;

export function readPickNotes(): { updatedAt: string | null; notes: Record<string, PickNote> } {
  try {
    const raw = JSON.parse(readFileSync(PICKUP_NOTES_PATH, "utf8")) as { updatedAt?: unknown; notes?: unknown };
    const notes = raw.notes && typeof raw.notes === "object" ? (raw.notes as Record<string, PickNote>) : {};
    return { updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null, notes };
  } catch {
    return { updatedAt: null, notes: {} };
  }
}

/** The PRs with Fox's notes on them, easy ones first, then smallest first. A
 * note for a PR no longer listed is dropped. */
export function withPickNotes(prs: TeamPr[], notes: Record<string, PickNote>): OpenReviewPr[] {
  const size = (p: TeamPr) => p.additions + p.deletions;
  return prs
    .map((p) => {
      const n = notes[`${p.repo}#${p.number}`];
      return {
        ...p,
        easy: n?.easy === true,
        why: typeof n?.why === "string" ? n.why : undefined,
      };
    })
    .sort((a, b) => Number(b.easy) - Number(a.easy) || size(a) - size(b));
}
