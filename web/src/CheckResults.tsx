import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { relTimeAgo } from "./format.ts";

// The object den's check workflow returns (server/doneCheck.ts), as a pane
// saved it.
interface Finding {
  severity: "high" | "medium" | "low";
  where: string;
  problem: string;
  fix: string;
  evidence?: string;
  from: string;
  verdict: { refuted: boolean; reason: string } | null;
  capped?: boolean;
  verifyFailed?: boolean;
}
export interface CheckResult {
  base?: string;
  summary?: string;
  error?: string;
  pr?: string;
  /** Ready-check verdict: nothing serious open and every helper reported. */
  ready?: boolean;
  tripwires?: { risk: string; why: string; humanTesting?: string }[];
  crew?: { name: string; failed: boolean; checked: string; notChecked: string }[];
  confirmed?: Finding[];
  unverified?: Finding[];
  refuted?: Finding[];
}

/** The pane's last check, re-read when asked; null before any was saved. */
export function useCheckResult(sessionId: string, poll = false) {
  const [data, setData] = useState<{ result: CheckResult | null; at: number | null }>({ result: null, at: null });
  useEffect(() => {
    let stop = false;
    const load = () =>
      api<{ result: CheckResult | null; at: number | null }>(`/api/sessions/${sessionId}/check-result`)
        .then((d) => !stop && setData(d))
        .catch(() => {});
    load();
    const t = poll ? setInterval(load, 15_000) : undefined;
    return () => {
      stop = true;
      if (t) clearInterval(t);
    };
  }, [sessionId, poll]);
  return data;
}

export function checkSummary(r: CheckResult): string {
  if (r.error) return r.error;
  const n = (l?: unknown[]) => l?.length ?? 0;
  const verdict = r.ready === undefined ? "" : r.ready ? "was ready, " : "wasn't ready, ";
  return `${verdict}${n(r.confirmed)} confirmed, ${n(r.unverified)} unverified, ${n(r.refuted)} refuted`;
}

function FindingRow({ f }: { f: Finding }) {
  const why = f.verdict
    ? `${f.verdict.refuted ? "Refuted" : "Confirmed"} by a skeptic: ${f.verdict.reason}`
    : f.capped
      ? "Not double-checked: past the run's limit."
      : f.verifyFailed
        ? "The double-check didn't finish."
        : f.severity === "low"
          ? "Low severity: not double-checked."
          : "";
  return (
    <div className={`check-finding ${f.severity}`}>
      <div className="check-finding-head">
        <span className={`check-sev ${f.severity}`}>{f.severity}</span>
        <span className="src-chip">{f.from}</span>
        <code>{f.where}</code>
      </div>
      <div>{f.problem}</div>
      {f.fix && <div className="check-fix">Fix: {f.fix}</div>}
      {f.evidence && <div className="check-evidence">Evidence: {f.evidence}</div>}
      {why && <div className="check-why">{why}</div>}
    </div>
  );
}

/** Every finding of the pane's last check, where it came from and what the
 * skeptic made of it, and what each helper ran and couldn't. */
export function CheckResultsDialog({ result, at, onClose }: { result: CheckResult; at: number | null; onClose: () => void }) {
  const groups: [string, Finding[] | undefined][] = [
    ["Confirmed", result.confirmed],
    ["Not double-checked", result.unverified],
    ["Refuted", result.refuted],
  ];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal check-results" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>
            Last check{result.base ? ` against ${result.base}` : ""}
            {at ? ` · ${relTimeAgo(at)}` : ""}
          </strong>
          <button className="btn-ghost" onClick={onClose} title="close">
            ×
          </button>
        </div>
        <div className="check-body">
          {result.ready !== undefined && (
            <p className={`check-verdict${result.ready ? " ready" : ""}`}>
              {result.ready
                ? "When it ran: ready for a human reviewer, with nothing serious left open."
                : "When it ran: not ready. The findings below were open, or a helper didn't finish. The session's own verdict, after its fixes, is in its chat."}
            </p>
          )}
          {result.summary && <p className="check-summary">{result.summary}</p>}
          {result.error && <p className="check-error">{result.error}</p>}
          {result.tripwires?.length ? (
            <section>
              <h5>Blast radius ({result.tripwires.length})</h5>
              {result.tripwires.map((t, i) => (
                <div key={i} className="check-finding medium">
                  <div>{t.risk}</div>
                  <div className="check-why">{t.why}</div>
                  {t.humanTesting && <div className="check-fix">A human must test: {t.humanTesting}</div>}
                </div>
              ))}
            </section>
          ) : null}
          {groups.map(([title, list]) =>
            list?.length ? (
              <section key={title}>
                <h5>
                  {title} ({list.length})
                </h5>
                {list.map((f, i) => (
                  <FindingRow key={i} f={f} />
                ))}
              </section>
            ) : null,
          )}
          {result.crew?.length ? (
            <section>
              <h5>Who checked what</h5>
              {result.crew.map((c) => (
                <div key={c.name} className="check-crew">
                  <span className="src-chip">{c.name}</span>
                  {c.failed ? (
                    <span className="check-error"> didn't finish: nothing it covers was checked.</span>
                  ) : (
                    <>
                      <div>Checked: {c.checked || "(not said)"}</div>
                      {c.notChecked && <div className="check-why">Not covered: {c.notChecked}</div>}
                    </>
                  )}
                </div>
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** "last check: N confirmed..." opening the results; nothing before a check. */
export function CheckResultsButton({ sessionId, poll = false }: { sessionId: string; poll?: boolean }) {
  const { result, at } = useCheckResult(sessionId, poll);
  const [open, setOpen] = useState(false);
  if (!result) return null;
  return (
    <>
      <button
        className="btn btn-ghost-outline check-results-btn"
        onClick={() => setOpen(true)}
        title="Every finding of the last check, where it came from, and what each helper ran"
      >
        last check: {checkSummary(result)}
      </button>
      {open && <CheckResultsDialog result={result} at={at} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The Review tab's deep review: the check workflow in review mode, asked of
 * the pane. Needs a second click while the field mouse says tokens are tight. */
export function DeepReviewButton({ sessionId, onStarted }: { sessionId: string; onStarted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [tight, setTight] = useState<string | null>(null);
  const run = () => {
    setBusy(true);
    api(`/api/sessions/${sessionId}/deep-review`, { method: "POST", body: JSON.stringify({ force: tight !== null }) })
      .then(() => {
        setTight(null);
        onStarted();
      })
      .catch((e) => {
        if ((e as { code?: string }).code === "tokens_tight") setTight((e as Error).message);
      })
      .finally(() => setBusy(false));
  };
  return (
    <button
      className={`btn btn-ghost-outline${tight ? " tight" : ""}`}
      disabled={busy}
      onClick={run}
      title={
        tight ??
        "A code-review pass, a ticket check, and the crew run in parallel, then a skeptic double-checks the serious findings. About as costly as ten helper asks."
      }
    >
      {busy ? "asking..." : tight ? "tokens tight: run anyway" : "deep review"}
    </button>
  );
}
