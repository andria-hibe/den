import { useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { Critter } from "./Critter.tsx";
import { CREW } from "./critterSprites.ts";
import { crewAskPrompt, crewFor, type CrewHelper, type CrewPane } from "./prompts.ts";

/** A pane header's crew: the helpers' busts in one button, lit while the pane
 * has that helper at work and dimmed otherwise, which opens a card listing
 * each helper's job with a button that asks the pane to call it. One button so
 * the header keeps room for the path and branch. */
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
  const card = useRef<HTMLDivElement>(null);

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
      if (!submit) input?.focus();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setAsking(null);
    }
  };

  const helpers = crewFor(pane);
  const name = (h: CrewHelper) => CREW.find((c) => c.kind === h)?.name ?? h;
  const working = helpers.filter((h) => active.includes(h));
  const face = (h: CrewHelper) => (
    <Critter kind={h} bust size={22} className={`crew-face${active.includes(h) ? " on" : ""}`} />
  );
  return (
    <>
      <button
        className={`crew-stack${open ? " on" : ""}`}
        aria-label="ask a helper"
        title={working.length ? `At work: ${working.map(name).join(", ")}` : "ask a helper"}
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
