// Wording and rules for removing a worktree den created. Removing one keeps
// its branch (server/git.ts removeWorktree), so what can be lost is only
// uncommitted work and commits on a detached HEAD. Pure, for the test.
import type { WorktreeChanges, WorktreeInfo } from "../../server/git.ts";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Does removing it lose work? Mirrors losesWork in server/git.ts, which is
 * what the server enforces; this copy only decides how the button reads. */
export function losesWork(c: WorktreeChanges | null | undefined): boolean {
  return !!c && (c.dirty > 0 || (c.detached && c.unpushed > 0));
}

/** One line on what removing the worktree costs, worst first. */
export function describeLoss(c: WorktreeChanges | null | undefined): string {
  if (!c) return "The folder is already gone. This clears git's record of it.";
  const lost: string[] = [];
  if (c.dirty > 0) lost.push(plural(c.dirty, "uncommitted change"));
  if (c.detached && c.unpushed > 0) lost.push(plural(c.unpushed, "commit") + " on no branch");
  if (lost.length) return `${lost.join(" and ")} will be lost.`;
  if (c.unpushed > 0) return `Nothing is lost. The branch keeps its ${plural(c.unpushed, "unpushed commit")}.`;
  return "Nothing is lost. The branch stays.";
}

/** Den worktrees that can go in one click: not in use, and nothing to lose. */
export function cleanRemovable(trees: WorktreeInfo[]): WorktreeInfo[] {
  return trees.filter((w) => w.den && !w.inUse && !losesWork(w.changes));
}
