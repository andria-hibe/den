import { useEffect, useState } from "react";
import { Fox } from "./Fox.tsx";
import { api } from "./api.ts";
import { Critter } from "./Critter.tsx";

interface Verdict {
  id: string;
  name: string;
  reasons: string[];
}

/** Clock out (#46): Hedgehog refreshes each chosen pane's handover, then ends
 * it; Start my day brings it back on a fresh conversation. Panes that must
 * stay up (mid-work, mid-merge, CI running...) start unticked, with the
 * reason, and can still be ticked. */
export function ClockOutDialog({ onDone, onError }: { onDone: () => void; onError: (msg: string) => void }) {
  const [panes, setPanes] = useState<Verdict[] | null>(null);
  const [prsKnown, setPrsKnown] = useState(true);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ panes: Verdict[]; prsKnown: boolean }>("/api/manager/clockout")
      .then((d) => {
        setPanes(d.panes);
        setPrsKnown(d.prsKnown);
        setChosen(new Set(d.panes.filter((p) => p.reasons.length === 0).map((p) => p.id)));
      })
      .catch((e) => {
        onError((e as Error).message);
        onDone();
      });
  }, [onDone, onError]);

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async () => {
    setBusy(true);
    try {
      await api("/api/manager/clockout", { method: "POST", body: JSON.stringify({ ids: [...chosen] }) });
      onDone();
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onDone}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="clockout-title">
            <Critter kind="hedgehog" size={38} />
            <strong>Clock out</strong>
          </span>
          <button className="btn-ghost" onClick={onDone} title="keep everything running" disabled={busy}>
            ×
          </button>
        </div>
        <p className="clockout-lede">
          Hedgehog updates each ticked session's handover, then ends its chat. Start my day brings it back
          tomorrow on a fresh chat that picks up from the handover.
        </p>
        {!panes ? (
          <div className="loading-row">
            <Fox pose="walk" size={20} /> Hedgehog is checking each session…
          </div>
        ) : panes.length === 0 ? (
          <div className="placeholder">Nothing is running.</div>
        ) : (
          panes.map((p) => (
            <label key={p.id} className="cleanup-option">
              <input type="checkbox" checked={chosen.has(p.id)} onChange={() => toggle(p.id)} disabled={busy} />
              <span>
                {p.name}
                <span className={`cleanup-sub${p.reasons.length ? " clockout-stay" : ""}`}>
                  {" "}
                  {p.reasons.length ? `keep up: ${p.reasons.join(", ")}` : "safe to end"}
                </span>
              </span>
            </label>
          ))
        )}
        {!prsKnown && <p className="clockout-lede">GitHub didn't answer, so running CI isn't checked.</p>}
        <div className="modal-foot">
          <button className="btn" onClick={onDone} disabled={busy}>
            keep everything running
          </button>
          <button className="btn btn-primary" onClick={run} disabled={busy || chosen.size === 0}>
            {busy ? "tucking in…" : `tuck in ${chosen.size}`}
          </button>
        </div>
      </div>
    </div>
  );
}
