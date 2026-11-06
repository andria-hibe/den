import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { relTimeAgo } from "./format.ts";
import { renderMarkdown } from "./markdown.ts";
import type { CrewRun } from "../../server/crewActivity.ts";

const minutes = (r: CrewRun) =>
  r.startedAt && r.endedAt ? `${Math.max(1, Math.round((r.endedAt - r.startedAt) / 60_000))} min` : "";
const model = (m: string | null) => (m ? m.replace(/^claude-/, "").replace(/-\d+(-\d+)?$/, "") : "");

/** What a helper was asked, the commands it ran, and what it reported. */
export function CrewRunDetails({ run }: { run: CrewRun }) {
  return (
    <div className="crew-run-body">
      <div className="crew-run-label">Asked</div>
      <div className="crew-run-text">{run.brief || "(not recorded)"}</div>
      {run.commands.length > 0 && (
        <>
          <div className="crew-run-label">Ran</div>
          {run.commands.map((c, i) => (
            <code key={i} className="crew-run-cmd">
              {c}
            </code>
          ))}
        </>
      )}
      <div className="crew-run-label">Reported</div>
      <div className="md crew-run-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(run.report || "(no report)") }} />
    </div>
  );
}

/** The helpers this pane called, newest first: what each was asked, the
 * commands it ran, and what it reported, so a finding can be traced to its run. */
export function CrewRuns({ sessionId }: { sessionId: string }) {
  const [runs, setRuns] = useState<CrewRun[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    api<{ runs: CrewRun[] }>(`/api/sessions/${sessionId}/crew-runs`)
      .then((d) => setRuns(d.runs))
      .catch(() => setRuns([]));
  }, [sessionId]);
  if (!runs?.length) return null;
  return (
    <details className="crew-runs">
      <summary>Recent helper runs ({runs.length})</summary>
      {runs.map((r) => (
        <div key={r.id} className="crew-run">
          <button className="crew-run-head" onClick={() => setOpen(open === r.id ? null : r.id)}>
            <span className="src-chip">{r.type}</span>
            <span>{[model(r.model), minutes(r), `${r.toolUses} tool uses`, r.endedAt ? relTimeAgo(r.endedAt) : ""].filter(Boolean).join(" · ")}</span>
          </button>
          {open === r.id && <CrewRunDetails run={r} />}
        </div>
      ))}
    </details>
  );
}
