import { useEffect, useState } from "react";
import { Fox } from "./Fox.tsx";
import { api } from "./api.ts";
import { Critter } from "./Critter.tsx";
import type { ClockOutRound, TuckStage } from "../../server/sessions.ts";

interface Verdict {
  id: string;
  name: string;
  reasons: string[];
}

const STAGE: Record<TuckStage, string> = {
  handover: "saving its handover…",
  ending: "ending its chat…",
  done: "tucked in",
  failed: "didn't end, still running",
};

const NAP_STAGE: Record<TuckStage, string> = { ...STAGE, done: "handover saved" };

/** Clock out (#46): Hedgehog refreshes each chosen pane's handover, then ends
 * it; Start my day brings it back on a fresh conversation. Panes that must
 * stay up (mid-work, mid-merge, CI running...) start unticked, with the
 * reason, and can still be ticked. Once started, it shows the round until
 * every pane is done, so the developer knows when the laptop can close. */
export function ClockOutDialog({
  round,
  onStarted,
  onDone,
  onError,
}: {
  /** The round to show, or null to choose panes for a new one. */
  round: ClockOutRound | null;
  onStarted: (round: ClockOutRound) => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [panes, setPanes] = useState<Verdict[] | null>(null);
  const [prsKnown, setPrsKnown] = useState(true);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Opened on a round: there's nothing to choose, so don't ask the server.
  const [choosing] = useState(!round);

  useEffect(() => {
    if (!choosing) return;
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
  }, [choosing, onDone, onError]);

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
      const r = await api<{ round: ClockOutRound }>("/api/manager/clockout", {
        method: "POST",
        body: JSON.stringify({ ids: [...chosen] }),
      });
      onStarted(r.round);
    } catch (e) {
      onError((e as Error).message);
    }
    setBusy(false);
  };

  if (round) return <RoundView round={round} onDone={onDone} />;

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

function RoundView({ round, onDone }: { round: ClockOutRound; onDone: () => void }) {
  if (round.kind === "nap") return <NapView round={round} onDone={onDone} />;
  const finished = !!round.finishedAt;
  const tucked = round.panes.filter((p) => p.stage === "done").length;
  const stillUp = round.panes.filter((p) => p.stage === "failed").length;
  const title = !finished ? "Tucking in…" : stillUp ? `Done, but ${stillUp} didn't end` : "All tucked in";
  return (
    <div className="modal-backdrop" onClick={onDone}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="clockout-title">
            <Critter kind="hedgehog" size={38} className={finished ? undefined : "fox-bob"} />
            <strong>{title}</strong>
          </span>
          <button className="btn-ghost" onClick={onDone} title={finished ? "close" : "hide: the topbar keeps count"}>
            ×
          </button>
        </div>
        {finished && !stillUp ? (
          <p className="clockout-safe">Safe to close your laptop.</p>
        ) : finished ? (
          <p className="clockout-lede">
            The sessions marked ! are still running, and their handovers may not be saved. Check them before
            you close your laptop.
          </p>
        ) : (
          <p className="clockout-lede">
            {tucked} of {round.panes.length} tucked in. Keep your laptop open until Hedgehog is done:
            closing it now stops the handovers it's writing.
          </p>
        )}
        <ul className="clockout-round">
          {round.panes.map((p) => (
            <li key={p.id} className={`clockout-pane is-${p.stage}`}>
              <span className="clockout-mark">{p.stage === "done" ? "✓" : p.stage === "failed" ? "!" : "·"}</span>
              <span>
                {p.name}
                <span className="cleanup-sub"> {STAGE[p.stage]}</span>
                {p.handoverFailed && <span className="cleanup-sub clockout-stay"> (handover not saved)</span>}
              </span>
            </li>
          ))}
        </ul>
        <div className="modal-foot">
          <button className={`btn${finished ? " btn-primary" : ""}`} onClick={onDone}>
            {finished ? "goodnight" : "hide"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A nap's round: handovers only, so nothing ends and there's no "safe to
 * close" beyond the handovers being saved. */
function NapView({ round, onDone }: { round: ClockOutRound; onDone: () => void }) {
  const finished = !!round.finishedAt;
  const saved = round.panes.filter((p) => p.stage === "done").length;
  const unsaved = round.panes.filter((p) => p.handoverFailed).length;
  const title = !finished
    ? "Saving handovers…"
    : unsaved
      ? `Done, but ${unsaved} handover${unsaved === 1 ? " wasn't" : "s weren't"} saved`
      : "Handovers saved";
  return (
    <div className="modal-backdrop" onClick={onDone}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="clockout-title">
            <Critter kind="hedgehog" size={38} className={finished ? undefined : "fox-bob"} />
            <strong>{title}</strong>
          </span>
          <button className="btn-ghost" onClick={onDone} title={finished ? "close" : "hide: the topbar keeps count"}>
            ×
          </button>
        </div>
        {finished && !unsaved ? (
          <p className="clockout-safe">Every session is still running, with its handover up to date. Enjoy the break.</p>
        ) : finished ? (
          <p className="clockout-lede">The sessions marked ! kept running but didn't get a fresh handover.</p>
        ) : (
          <p className="clockout-lede">
            {saved} of {round.panes.length} saved. Sessions keep running. Keep your laptop open until Hedgehog is
            done: closing it now stops the handovers it's writing.
          </p>
        )}
        <ul className="clockout-round">
          {round.panes.map((p) => (
            <li key={p.id} className={`clockout-pane is-${p.handoverFailed ? "failed" : p.stage}`}>
              <span className="clockout-mark">{p.handoverFailed ? "!" : p.stage === "done" ? "✓" : "·"}</span>
              <span>
                {p.name}
                <span className="cleanup-sub"> {p.handoverFailed ? "handover not saved" : NAP_STAGE[p.stage]}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="modal-foot">
          <button className={`btn${finished ? " btn-primary" : ""}`} onClick={onDone}>
            {finished ? "enjoy the break" : "hide"}
          </button>
        </div>
      </div>
    </div>
  );
}
