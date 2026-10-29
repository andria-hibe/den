import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api.ts";
import { renderMarkdown } from "./markdown.ts";
import { relTimeAgo } from "./format.ts";
import { Splitter, clamp } from "./Splitter.tsx";
import { usePersistentNumber } from "./usePersistent.ts";
import { Fox } from "./Fox.tsx";
import { Critter } from "./Critter.tsx";
import { CREW } from "./critterSprites.ts";

/** Checklist marks as glyphs: markdown.ts has no task-list syntax. */
export function todayMarkdown(md: string): string {
  return md.replace(/^(\s*)- \[ \] /gm, "$1- ☐ ").replace(/^(\s*)- \[[xX]\] /gm, "$1- ☑ ");
}

/** Turns each "(session: Name)" in rendered Today HTML into a button that
 * opens that session. `html` comes from renderMarkdown, so the name is
 * already escaped and goes into the attribute as is. */
export function linkSessions(html: string): string {
  return html.replace(
    /\(session: ([^)<]+)\)/g,
    (_, name: string) => `<button class="today-session" data-session="${name.trim()}">${name.trim()}</button>`,
  );
}

/** How many items are still open in a Today list. */
export function openItems(md: string): number {
  return (md.match(/^\s*- \[ \] /gm) ?? []).length;
}

/** The Manager's layout (#46): the Today list it keeps above, its pane below,
 * one splitter, like the review view, so it fits a small screen. */
export function TodayView({
  foxRunning,
  onStartDay,
  onOpenSession,
  header,
  terminal,
}: {
  foxRunning: boolean;
  onStartDay: () => Promise<void>;
  /** Open the rail session with this name. */
  onOpenSession: (name: string) => void;
  header: ReactNode;
  terminal: ReactNode;
}) {
  const [today, setToday] = useState<{ content: string; writtenAt: number } | null>(null);
  const [frac, setFrac] = usePersistentNumber("den.todayFrac", 0.58);
  const [starting, setStarting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      api<{ content: string; writtenAt: number }>("/api/manager/today")
        .then((d) => !stop && setToday(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  const start = async () => {
    setStarting(true);
    try {
      await onStartDay();
    } finally {
      setStarting(false);
    }
  };

  const content = today?.content.trim() ?? "";
  return (
    <div className="pr-review" ref={rootRef}>
      <div className="ws-pane pr-info" style={{ flex: `${frac} 1 0` }}>
        <div className="today-head">
          <span className="pr-info-title">Today</span>
          {content && <span className="today-open">{openItems(content)} open</span>}
          {today?.writtenAt ? <span className="today-when">updated {relTimeAgo(today.writtenAt)}</span> : null}
          <span className="today-crew">
            {CREW.map((c) => {
              const awake = c.kind === "fox" ? foxRunning : c.built;
              const state = c.built ? (awake ? "" : " (asleep: start my day wakes it)") : " (coming soon)";
              return (
                <span
                  key={c.kind}
                  className={`today-critter${awake ? "" : " resting"}`}
                  title={`${c.name}: ${c.job}. Runs on ${c.model}.${state}`}
                >
                  {c.kind === "fox" ? (
                    <Fox pose={foxRunning ? "sit" : "sleep"} size={38} />
                  ) : (
                    <Critter kind={c.kind} size={38} />
                  )}
                </span>
              );
            })}
          </span>
          <button className="btn btn-ghost-outline today-start" disabled={starting} onClick={start}>
            {starting ? "starting…" : "☀ start my day"}
          </button>
        </div>
        {content ? (
          <div
            className="pr-info-scroll md today-list"
            onClick={(e) => {
              const name = (e.target as HTMLElement).closest<HTMLElement>(".today-session")?.dataset.session;
              if (name) onOpenSession(name);
            }}
            dangerouslySetInnerHTML={{ __html: linkSessions(renderMarkdown(todayMarkdown(content))) }}
          />
        ) : (
          <div className="placeholder today-empty">
            Nothing yet. "Start my day" has Fox read every session, your PRs, and Linear, and
            write the list here.
          </div>
        )}
      </div>
      <Splitter
        dir="y"
        onDrag={(d) => setFrac((f) => clamp(f + d / (rootRef.current?.clientHeight ?? 1), 0.2, 0.85))}
      />
      <div className="ws-main" style={{ flex: `${1 - frac} 1 0` }}>
        {header}
        {terminal}
      </div>
    </div>
  );
}
