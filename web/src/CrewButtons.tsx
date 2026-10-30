import { useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { Critter } from "./Critter.tsx";
import { CREW } from "./critterSprites.ts";
import { crewAskPrompt, type CrewHelper } from "./prompts.ts";

/** The helpers each pane kind has as subagents (server/crew.ts): a review
 * pane is Owl itself, so it has no Owl to call. */
export function crewFor(review: boolean): CrewHelper[] {
  return review ? ["badger", "hare", "wolf", "raccoon"] : ["owl", "badger", "hare", "wolf", "raccoon"];
}

/** A pane header's crew: the helpers' busts in one button, which opens a card
 * listing each helper's job with a button that asks the pane to call it. One
 * button so the header keeps room for the path and branch; a card because
 * den's window doesn't show native tooltips. */
export function CrewButtons({
  sessionId,
  review,
  running,
  onError,
}: {
  sessionId: string;
  review: boolean;
  running: boolean;
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

  const ask = async (helper: CrewHelper) => {
    setAsking(helper);
    try {
      await api(`/api/sessions/${sessionId}/paste`, {
        method: "POST",
        body: JSON.stringify({ text: crewAskPrompt(helper, review), submit: true }),
      });
      setOpen(null);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setAsking(null);
    }
  };

  const helpers = crewFor(review);
  return (
    <>
      <button
        className={`crew-stack${open ? " on" : ""}`}
        aria-label="ask a helper"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpen(open ? null : { top: r.bottom + 6, right: window.innerWidth - r.right });
        }}
      >
        {helpers.map((h) => (
          <Critter key={h} kind={h} bust size={22} />
        ))}
      </button>
      {open && (
        <div className="crew-card" ref={card} style={{ top: open.top, right: open.right }}>
          {helpers.map((h) => {
            const member = CREW.find((c) => c.kind === h);
            return (
              <div className="crew-row" key={h}>
                <span className="crew-row-face">
                  <Critter kind={h} bust size={22} />
                </span>
                <div className="crew-row-text">
                  <strong>{member?.name ?? h}</strong>
                  <div className="crew-card-job">{member?.job}</div>
                </div>
                <button
                  className="btn btn-ghost-outline crew-ask"
                  disabled={!running || asking !== null}
                  onClick={() => ask(h)}
                >
                  {asking === h ? "asking..." : "ask"}
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
