import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";
import { relTimeAgo } from "./format.ts";
import type { BugCard, SkippedBug, TriageCard } from "../../server/bugBuster.ts";

interface ClaimResult {
  claimed: string[];
  assigned: string[];
  notAssigned: string[];
  assignError: string | null;
  skipped: SkippedBug[];
  started: string[];
  view: BugView;
}
import type { BugIssue } from "../../server/linear.ts";

interface BugView {
  on: boolean;
  project: { slugId: string; name: string } | null;
  triageTeam: { key: string; name: string } | null;
  scoutedAt: string | null;
  claimed: string[];
  started: string[];
  held: { identifier: string; why: string }[];
  atWork: string[];
  queue: { fetchedAt: string; queue: BugIssue[]; skipped: SkippedBug[]; triage: BugIssue[] } | null;
  result: { bugs: BugCard[]; triage: TriageCard[] } | null;
  resultAt: number | null;
}

/** Bug buster (server/bugBuster.ts): the developer turns it on when they're
 * on rapid response, claims bugs from the ranked queue, and reads the triage
 * cards; Fox scouts and leads the bug sessions. */
export function BugsTab() {
  const [view, setView] = useState<BugView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [setup, setSetup] = useState(false);

  const load = useCallback(
    () =>
      api<BugView>("/api/bugs")
        .then((v) => (setView(v), setError(null)))
        .catch((e) => setError((e as Error).message)),
    [],
  );
  useEffect(() => {
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const post = <T,>(url: string, body?: unknown) =>
    api<T>(url, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

  if (!view)
    return (
      <div className="pr-section">
        {error ? <div className="browser-error">⚠️ {error} (trying again every 30 seconds)</div> : <div className="loading-row">loading...</div>}
      </div>
    );

  if (!view.project || !view.triageTeam || setup) {
    return (
      <div className="pr-section bugs-tab">
        <BugSetup
          view={view}
          busy={busy}
          onCancel={view.project && view.triageTeam ? () => setSetup(false) : undefined}
          onSave={(project, triageTeam) =>
            act(async () => {
              setView(await post<BugView>("/api/bugs/settings", { project, triageTeam }));
              setSetup(false);
            })
          }
        />
        {error && <div className="browser-error">⚠️ {error}</div>}
      </div>
    );
  }

  const cards = new Map((view.result?.bugs ?? []).map((c) => [c.id, c]));
  const claimed = new Set(view.claimed);
  const atWork = new Set(view.atWork);
  const held = new Map(view.held.map((h) => [h.identifier, h.why]));
  const started = new Set(view.started);
  const queue = view.queue?.queue ?? [];
  const toClaim = [...picked].filter((id) => !claimed.has(id) && queue.some((b) => b.identifier === id));

  return (
    <div className="pr-section bugs-tab">
      <div className="bugs-head">
        <span className="bugs-status">
          {view.on ? "🐛 Bug buster is on" : "Bug buster is off"}
          <span className="bugs-sub">
            {view.project.name} · triage: {view.triageTeam.name}
            {view.scoutedAt && ` · scouted ${relTimeAgo(view.scoutedAt)}`}
          </span>
        </span>
        <button className="btn-ghost bugs-change" onClick={() => setSetup(true)} title="Change the project or the triage team">
          Change
        </button>
      </div>
      <div className="bugs-actions">
        <button
          className="btn"
          disabled={busy}
          onClick={() => act(async () => setView(await post<BugView>("/api/bugs/start")))}
          title="Rank the project's open bugs and have Fox scout the top ones and card the triage queue"
        >
          {view.on ? "Scout again" : "Start bug buster"}
        </button>
        {view.on && (
          <button
            className="btn btn-ghost-outline"
            disabled={busy}
            onClick={() => act(async () => setView(await post<BugView>("/api/bugs/stop")))}
            title="Stop starting bug sessions; the ones at work carry on"
          >
            Stop
          </button>
        )}
      </div>
      {error && <div className="browser-error">⚠️ {error}</div>}
      {note && <div className="bugs-note">{note}</div>}
      {!view.queue && <div className="placeholder">Start bug buster to rank the project's open bugs.</div>}
      {view.on && view.scoutedAt && (!view.resultAt || view.resultAt < Date.parse(view.scoutedAt)) && (
        <div className="placeholder">Fox is scouting: the cards appear here when it's done.</div>
      )}

      {view.queue && (
        <>
          <div className="pr-section-title">
            <span>bugs nobody has started</span>
            <span className="pr-count">{queue.length}</span>
          </div>
          {!queue.length && <div className="placeholder">none right now</div>}
          {queue.map((b) => (
            <BugRow
              key={b.identifier}
              bug={b}
              card={cards.get(b.identifier)}
              status={
                held.has(b.identifier) ? `not started: ${held.get(b.identifier)}`
                : atWork.has(b.identifier) ? "at work"
                : started.has(b.identifier) ? "started"
                : claimed.has(b.identifier) ? "claimed, waiting for a slot"
                : null
              }
              picked={picked.has(b.identifier)}
              onPick={
                view.on && !claimed.has(b.identifier)
                  ? (on) => setPicked((p) => {
                      const n = new Set(p);
                      if (on) n.add(b.identifier);
                      else n.delete(b.identifier);
                      return n;
                    })
                  : undefined
              }
            />
          ))}
          {view.on && (
            <button
              className="btn bugs-claim"
              disabled={busy || !toClaim.length}
              title="Assign them to you in Linear (only the unassigned ones), then start a session for each as slots free up, five at a time"
              onClick={() =>
                act(async () => {
                  const r = await post<ClaimResult>("/api/bugs/claim", { ids: toClaim });
                  setView(r.view);
                  setPicked(new Set());
                  setNote(
                    [
                      r.claimed.length && `Claimed ${r.claimed.join(", ")}.`,
                      r.assigned.length && `Assigned to you: ${r.assigned.join(", ")}.`,
                      r.notAssigned.length &&
                        `Couldn't assign ${r.notAssigned.join(", ")} in Linear${r.assignError ? ` (${r.assignError})` : ""}: assign them yourself.`,
                      r.started.length && `Started: ${r.started.join(", ")}.`,
                      r.skipped.length && `Skipped: ${r.skipped.map((s) => `${s.identifier} (${s.why})`).join(", ")}.`,
                    ]
                      .filter(Boolean)
                      .join(" ") || "Nothing to claim.",
                  );
                })
              }
            >
              Claim {toClaim.length || ""} and start
            </button>
          )}
          {!!view.queue.skipped.length && (
            <details className="bugs-skipped">
              <summary>skipped ({view.queue.skipped.length})</summary>
              {view.queue.skipped.map((s) => (
                <div key={s.identifier}>
                  {s.identifier} {s.title}: {s.why}
                </div>
              ))}
            </details>
          )}

          <div className="pr-section-title">
            <span>triage</span>
            <span className="pr-count">{view.queue.triage.length}</span>
          </div>
          {!view.queue.triage.length && <div className="placeholder">the triage queue is empty</div>}
          {view.queue.triage.map((t) => (
            <TriageRow key={t.identifier} issue={t} card={view.result?.triage.find((c) => c.id === t.identifier)} />
          ))}
        </>
      )}
    </div>
  );
}

function BugSetup({
  view,
  busy,
  onSave,
  onCancel,
}: {
  view: BugView;
  busy: boolean;
  onSave: (project: string, triageTeam: string) => void;
  onCancel?: () => void;
}) {
  const [project, setProject] = useState("");
  const [team, setTeam] = useState(view.triageTeam?.key ?? "");
  return (
    <form
      className="bugs-setup"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(project, team);
      }}
    >
      <div className="bugs-status">Set up bug buster</div>
      <label>
        Linear project URL{view.project && ` (now ${view.project.name}; leave empty to keep it)`}
        <input
          className="checks-search"
          value={project}
          placeholder="https://linear.app/.../project/..."
          onChange={(e) => setProject(e.target.value)}
        />
      </label>
      <label>
        Triage team (key or name)
        <input className="checks-search" value={team} onChange={(e) => setTeam(e.target.value)} />
      </label>
      <div className="bugs-actions">
        <button className="btn" type="submit" disabled={busy || (!project.trim() && !view.project) || !team.trim()}>
          Save
        </button>
        {onCancel && (
          <button className="btn btn-ghost-outline" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function BugRow({
  bug,
  card,
  status,
  picked,
  onPick,
}: {
  bug: BugIssue;
  card: BugCard | undefined;
  status: string | null;
  picked: boolean;
  onPick?: (on: boolean) => void;
}) {
  const scouted = card && !card.failed;
  return (
    <div className={`checks-entry bugs-entry${picked ? " open" : ""}`}>
      <div className="bugs-entry-head">
        {onPick && (
          <label className="bugs-pick">
            <input type="checkbox" checked={picked} onChange={(e) => onPick(e.target.checked)} aria-label={`claim ${bug.identifier}`} />
          </label>
        )}
        <span className="checks-entry-text">
          <span className="checks-entry-top">
            <a href={bug.url} target="_blank" rel="noreferrer" className="checks-entry-session">
              {bug.identifier}
            </a>
            <span className="src-chip">{bug.priorityLabel}</span>
            {scouted && <span className="src-chip">{card.size}</span>}
            {scouted && <span className={`src-chip${card.simple ? " verified" : ""}`}>{card.simple ? "simple" : "ask first"}</span>}
            {status && <span className="checks-entry-when">{status}</span>}
          </span>
          <span className="checks-entry-summary">{bug.title}</span>
          {scouted ? (
            <>
              {card.symptom && <span className="checks-entry-where">{card.symptom}</span>}
              {card.plan && <span className="checks-entry-where">Plan: {card.plan}</span>}
              <span className="checks-entry-where">
                {card.simple ? "Simple" : "Ask first"}: {card.simpleWhy}
              </span>
              {card.secondOpinion && <span className="checks-entry-where">Second opinion: {card.secondOpinion}</span>}
              {card.startedElsewhere && <span className="checks-entry-where">May already be started: {card.startedElsewhere}</span>}
            </>
          ) : (
            card?.failed && <span className="checks-entry-where">The scout failed on this one.</span>
          )}
        </span>
      </div>
    </div>
  );
}

function TriageRow({ issue, card }: { issue: BugIssue; card: TriageCard | undefined }) {
  const carded = card && !card.failed;
  return (
    <div className="checks-entry bugs-entry">
      <div className="bugs-entry-head">
        <span className="checks-entry-text">
          <span className="checks-entry-top">
            <a href={issue.url} target="_blank" rel="noreferrer" className="checks-entry-session">
              {issue.identifier}
            </a>
            {carded && (
              <>
                <span className="src-chip">{card.isBug ? card.suggestedPriority : "not a bug"}</span>
                <span className="src-chip">{card.size}</span>
                {card.easy && <span className="src-chip verified">easy</span>}
              </>
            )}
            <span className="checks-entry-when">{relTimeAgo(issue.createdAt)}</span>
          </span>
          <span className="checks-entry-summary">{issue.title}</span>
          {carded && (
            <>
              {card.symptom && <span className="checks-entry-where">{card.symptom}</span>}
              {card.who && <span className="checks-entry-where">Who: {card.who}</span>}
              {card.related?.length ? <span className="checks-entry-where">Related: {card.related.join(", ")}</span> : null}
              {card.nextStep && <span className="checks-entry-where">Next: {card.nextStep}</span>}
            </>
          )}
          {card?.failed && <span className="checks-entry-where">The triage helper failed on this one.</span>}
        </span>
      </div>
    </div>
  );
}
