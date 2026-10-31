import { useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { Critter } from "./Critter.tsx";
import { CREW } from "./critterSprites.ts";
import { crewAskPrompt, crewFor, type CrewHelper, type CrewPane } from "./prompts.ts";

/** How long a helper asked from the card shows as on its way before the pane
 * has started it: a pane from before the crew hooks never reports one. */
const CALLED_MS = 2 * 60_000;

type Called = Partial<Record<CrewHelper, number>>;

/** Helpers asked for per session, outside the component so they survive a
 * switch to another session and back, and never show on the wrong one. */
const calledBy = new Map<string, Called>();

/** Asks to one pane run one at a time: the paste route waits for the pane to
 * go quiet, and two pastes let through together would land in one prompt. */
const queueBy = new Map<string, Promise<unknown>>();

/** A pane header's crew: the helpers' heads in one button, bouncing while
 * the pane has that helper at work (or it was just asked for) and dimmed
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
  const [asking, setAsking] = useState<CrewHelper[]>([]);
  // Helpers asked for from the card that the pane hasn't started yet.
  const [called, setCalledState] = useState<Called>(() => calledBy.get(sessionId) ?? {});
  const setCalled = (update: (prev: Called) => Called) => {
    const next = update(calledBy.get(sessionId) ?? {});
    calledBy.set(sessionId, next);
    setCalledState(next);
  };
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const keys = Object.keys(called) as CrewHelper[];
    if (!keys.length) return;
    if (!running) {
      setCalled(() => ({}));
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
    // setCalled only writes this session's entry and state; it needn't be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const ask = (helper: CrewHelper, from: HTMLElement) => {
    const { text, submit, digest } = crewAskPrompt(helper, pane);
    // The card sits in the pane's header, so this finds that pane's terminal.
    const input = from.closest(".ws-main")?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
    setAsking((prev) => [...prev, helper]);
    if (submit) setCalled((prev) => ({ ...prev, [helper]: Date.now() }));
    const job = (queueBy.get(sessionId) ?? Promise.resolve()).then(async () => {
      if (digest) await api("/api/manager/digest", { method: "POST" });
      await api(`/api/sessions/${sessionId}/paste`, {
        method: "POST",
        body: JSON.stringify({ text, submit }),
      });
    });
    queueBy.set(sessionId, job.catch(() => {}));
    job
      .then(() => {
        // Queued behind earlier asks, it may only now have reached the pane.
        if (submit) setCalled((prev) => ({ ...prev, [helper]: Date.now() }));
        // A brief waits in the prompt for the developer to finish it.
        else {
          setOpen(null);
          input?.focus();
        }
      })
      .catch((e) => {
        onError((e as Error).message);
        setCalled((prev) => Object.fromEntries(Object.entries(prev).filter(([h]) => h !== helper)));
      })
      .finally(() => setAsking((prev) => prev.filter((h) => h !== helper)));
  };

  const helpers = crewFor(pane);
  const name = (h: CrewHelper) => CREW.find((c) => c.kind === h)?.name ?? h;
  const onWay = (h: CrewHelper) => !active.includes(h) && (asking.includes(h) || called[h] !== undefined);
  const busy = (h: CrewHelper) => active.includes(h) || onWay(h);
  const working = helpers.filter(busy);
  // Heads in the header; the whole animal in the card, where you ask it for a job.
  const face = (h: CrewHelper, whole = false) => (
    <Critter kind={h} bust={!whole} size={whole ? 38 : 22} className={`crew-face${busy(h) ? " on" : ""}`} />
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
                <span className="crew-row-face">{face(h, true)}</span>
                <div className="crew-row-text">
                  <strong>{member?.name ?? h}</strong>
                  {active.includes(h) && <span className="crew-working">at work</span>}
                  {onWay(h) && <span className="crew-working">on its way</span>}
                  <div className="crew-card-job">{member?.job}</div>
                </div>
                <button
                  className="btn btn-ghost-outline crew-ask"
                  disabled={!running || asking.includes(h)}
                  title={brief ? "Starts the message in the prompt for you to finish" : undefined}
                  onClick={(e) => ask(h, e.currentTarget)}
                >
                  {asking.includes(h) ? "asking..." : brief ? "brief" : "ask"}
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
