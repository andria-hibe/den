// Which branches a new work branch can start from besides the repo's base
// (#26): the branches open in a worktree, since a ticket that builds on
// another is stacked on a branch you are working on.
import type { Worktree } from "../../server/git.ts";

/** Branches to offer as a base for `creating`, in worktree order: each open
 * worktree's branch, minus the branch being created, the repo base (already
 * the default), detached checkouts, and duplicates. */
export function stackCandidates(
  worktrees: Worktree[],
  creating: string | null | undefined,
  base: string | null | undefined,
): string[] {
  const seen = new Set<string>();
  for (const w of worktrees) {
    const b = w.branch;
    if (!b || b === creating || b === base || seen.has(b)) continue;
    seen.add(b);
  }
  return [...seen];
}
