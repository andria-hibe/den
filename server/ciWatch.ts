// den watches CI for every PR it lists and tells the sessions working on one
// when its checks finish (#36), so a session needn't keep a background
// `gh pr checks --watch` alive, which a restart or a network blip killed.
import type { CheckState, PullRequest } from "./github.ts";

const key = (pr: PullRequest) => `${pr.repo}#${pr.number}`;

export interface CiFinish {
  pr: PullRequest;
  to: "passing" | "failing";
}

/** PRs whose checks went from pending to a result since `last`, which is
 * updated in place. A PR seen for the first time isn't reported: after a
 * server restart den can't tell whether it already said so. */
export function ciFinishes(last: Map<string, CheckState>, prs: PullRequest[]): CiFinish[] {
  const out: CiFinish[] = [];
  for (const pr of prs) {
    const before = last.get(key(pr));
    last.set(key(pr), pr.checks);
    if (before === "pending" && (pr.checks === "passing" || pr.checks === "failing")) {
      out.push({ pr, to: pr.checks });
    }
  }
  return out;
}

export function ciMessage({ pr, to }: CiFinish): string {
  const c = pr.checkCounts;
  const result = to === "passing" ? `passed (${c.passed} checks)` : `failed (${c.failed} of ${c.total} checks failing)`;
  const head = `CI on PR #${pr.number} (${pr.repo}, branch ${pr.branch ?? "unknown"}) finished and ${result}.`;
  const failing = pr.failingChecks ?? [];
  if (to === "passing" || !failing.length) return head;
  const list = failing.map((f) => `- ${f.name}${f.link ? `: ${f.link}` : ""}`).join("\n");
  return `${head}\nFailing:\n${list}\nHand these to raccoon, your CI subagent, before reading the logs yourself.`;
}
