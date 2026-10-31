import { useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { Critter } from "./Critter.tsx";
import { CREW } from "./critterSprites.ts";
import { crewAskPrompt, crewFor, type CrewHelper, type CrewPane } from "./prompts.ts";

/** How long a helper asked from the card shows as on its way before the pane
 * has started it: a pane from before the crew hooks never reports one. */
const CALLED_MS = 2 * 60_000;

/** A pane header's crew: the helpers' busts in one button, walking while the
 * pane has that helper at work (or it was just asked for) and dimmed
 * otherwise, which opens a card listing each helper's job with a button that
 * asks the pane to call it. One button so the header keeps room for the path
 * and branch. */
export function CrewButtons({
  sessionId,
  pane,
  running,
  active,
  onError,
}: {
  sessionId: string;
  pane: CrewPane;
  running: boolean;
  /** Agent types the pane has at work (SessionMeta.crewActive). */
  active: string[];
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState<{ top: number; right: number } | null>(null);
  const [asking, setAsking] = useState<CrewHelper | null>(null);
  // Helpers asked for from the card that the pane hasn't started yet.
  const [called, setCalled] = useState<Partial<Record<CrewHelper, number>>>({});
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const keys = Object.keys(called) as CrewHelper[];
    if (!keys.length) return;
    if (!running) {
      setCalled({});
      return;
    }
    // Once the pane has started a helper, `active` shows it from then on.
    const started = keys.filter((h) => active.includes(h));
    if (started.length) {
      setCalled((prev) => Object.fromEntries(Object.entries(prev).filter(([h]) => !started.includes(h as CrewHelper))));
      return;
    }
    const next = Math.min(...keys.map((h) => called[h]!)) + CALLED_MS - Date.now();
    const t = setTimeout(
      () => setCalled((prev) => Object.fromEntries(Object.entries(prev).filter(([, at]) => Date.now() - at < CALLED_MS))),
      Math.max(0, next),
    );
    return () => clearTimeout(t);
  }, [called, active, running]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !card.current?.contains(e.target as Node)) {
        setOpen(null);
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  const ask = async (helper: CrewHelper, from: HTMLElement) => {
    const { text, submit, digest } = crewAskPrompt(helper, pane);
    // The card sits in the pane's header, so this finds that pane's terminal.
    const input = from.closest(".ws-main")?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
    setAsking(helper);
    try {
      if (digest) await api("/api/manager/digest", { method: "POST" });
      await api(`/api/sessions/${sessionId}/paste`, {
        method: "POST",
        body: JSON.stringify({ text, submit }),
      });
      setOpen(null);
      if (submit) setCalled((prev) => ({ ...prev, [helper]: Date.now() }));
      else input?.focus();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setAsking(null);
    }
  };

  const helpers = crewFor(pane);
  const name = (h: CrewHelper) => CREW.find((c) => c.kind === h)?.name ?? h;
  const onWay = (h: CrewHelper) => !active.includes(h) && (asking === h || called[h] !== undefined);
  const busy = (h: CrewHelper) => active.includes(h) || onWay(h);
  const working = helpers.filter(busy);
  const face = (h: CrewHelper) => (
    <Critter kind={h} bust size={22} className={`crew-face${busy(h) ? " on" : ""}`} />
  );
  return (
    <>
      <button
        className={`crew-stack${open ? " on" : ""}`}
        aria-label="ask a helper"
        title={working.length ? `Busy: ${working.map(name).join(", ")}` : "ask a helper"}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpen(open ? null : { top: r.bottom + 6, right: window.innerWidth - r.right });
        }}
      >
        {helpers.map((h) => (
          <span key={h}>{face(h)}</span>
        ))}
      </button>
      {open && (
        <div className="crew-card" ref={card} style={{ top: open.top, right: open.right }}>
          {helpers.map((h) => {
            const member = CREW.find((c) => c.kind === h);
            const brief = !crewAskPrompt(h, pane).submit;
            return (
              <div className="crew-row" key={h}>
                <span className="crew-row-face">{face(h)}</span>
                <div className="crew-row-text">
                  <strong>{member?.name ?? h}</strong>
                  {active.includes(h) && <span className="crew-working">at work</span>}
                  {onWay(h) && <span className="crew-working">on its way</span>}
                  <div className="crew-card-job">{member?.job}</div>
                </div>
                <button
                  className="btn btn-ghost-outline crew-ask"
                  disabled={!running || asking !== null}
                  title={brief ? "Starts the message in the prompt for you to finish" : undefined}
                  onClick={(e) => ask(h, e.currentTarget)}
                >
                  {asking === h ? "asking..." : brief ? "brief" : "ask"}
                </button>
              </div>
            );
          })}
          {!running && <div className="crew-card-note">Restart the session to ask its helpers.</div>}
        </div>
      )}
    </>
  );
}
