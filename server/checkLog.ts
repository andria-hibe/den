// The checks log: every crew helper's finished run and every check workflow's
// result, kept in the database after its workspace closes, so the developer
// can look back at which security, performance, or design checks were done
// and what they found. The runs log and the saved check result it reads from
// are deleted with the workspace (sessions.remove), so it is read just before.
import { readFileSync, statSync } from "node:fs";
import { store } from "./store.ts";
import { newCrewRuns } from "./crewActivity.ts";
import { checkResultPath, validCheckResult } from "./doneCheck.ts";
import { logWarn } from "./log.ts";

/** The crew whose runs are logged: kitAgents, reviewAgents, managerAgents. */
const LOGGED_CREW: ReadonlySet<string> = new Set(["owl", "badger", "hare", "wolf", "bowerbird", "raccoon", "tanuki", "squirrel"]);

/** Rows kept; the oldest go first. */
const KEEP = 2000;

export interface CheckSource {
  groupId: string;
  session: string;
  repo: string | null;
  branch: string | null;
  ticket: string | null;
  pr: string | null;
  /** A review pane, whose check result is a deep review, not a ready check. */
  review: boolean;
}

/** A report's first line of prose, for the list. */
export function firstLine(text: string): string {
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^[\s>#*-]+/, "").replace(/\*\*/g, "").trim();
    if (line) return line.length > 200 ? `${line.slice(0, 199)}...` : line;
  }
  return "(no report)";
}

/** Log what is new since the last call: helper runs, and a check result
 * saved since the last one. */
export function recordChecks(sources: CheckSource[], now = Date.now()): void {
  let added = 0;
  for (const src of sources) {
    const ctx = { session: src.session, repo: src.repo, branch: src.branch, ticket: src.ticket, pr: src.pr };
    try {
      for (const run of newCrewRuns(src.groupId, LOGGED_CREW, (id) => store.hasCheck(id))) {
        store.addCheck({ id: run.id, at: run.endedAt ?? now, kind: run.type, ...ctx, summary: firstLine(run.report), body: JSON.stringify(run) });
        added++;
      }
      const file = checkResultPath(src.groupId);
      let mtime: number;
      try {
        mtime = statSync(file).mtimeMs;
      } catch {
        continue;
      }
      const id = `check-${src.groupId}-${Math.round(mtime)}`;
      if (store.hasCheck(id)) continue;
      let result: Record<string, unknown> | null = null;
      try {
        result = validCheckResult(JSON.parse(readFileSync(file, "utf8")));
      } catch {
        // half-written, or not JSON: the next round tries again
      }
      // A run always reports its helpers or an error; anything else isn't one.
      if (!result || (!(result.crew as unknown[]).length && !result.error)) continue;
      const counts = (["confirmed", "unverified", "refuted"] as const)
        .map((k) => `${(result[k] as unknown[]).length} ${k}`)
        .join(", ");
      const verdict = result.ready === true ? "was ready; " : result.ready === false ? "wasn't ready; " : "";
      const kind = src.review ? "deep review" : "ready check";
      store.addCheck({ id, at: Math.round(mtime), kind, ...ctx, summary: `${verdict}${counts}`, body: JSON.stringify(result) });
      added++;
    } catch (err) {
      logWarn("checks log", err);
    }
  }
  if (added) store.pruneChecks(KEEP);
}
