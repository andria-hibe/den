import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api.ts";
import { renderMarkdown } from "./markdown.ts";
import { relTimeAgo } from "./format.ts";
import { Splitter, clamp } from "./Splitter.tsx";
import { usePersistentNumber } from "./usePersistent.ts";
import { Fox } from "./Fox.tsx";
import { Critter } from "./Critter.tsx";
import { CREW } from "./critterSprites.ts";
import { todayItems, type TodayItemState } from "../../server/manager.ts";

// Private-use characters mark where each checklist box goes, so a ☐ or ☑
// in an item's own text can't be taken for one.
const OPEN_MARK = "\uE000";
const DONE_MARK = "\uE001";
const WONTDO_MARK = "\uE002";
const WONTDO_DETAIL = "\uE003";

/** Checklist marks as box markers: markdown.ts has no task-list syntax. A
 * won't-do item's indented detail bullets are marked too, since markdown.ts
 * renders them as sibling items rather than nesting them. */
export function todayMarkdown(md: string): string {
  let wontdoIndent = -1;
  return md
    .split("\n")
    .map((line) => {
      const indent = line.length - line.trimStart().length;
      if (wontdoIndent >= 0 && line.trim() && indent <= wontdoIndent) wontdoIndent = -1;
      if (/^\s*- \[-\] /.test(line)) wontdoIndent = indent;
      else if (wontdoIndent >= 0 && /^\s*- (?!\[[ xX-]\] )/.test(line)) return line.replace("- ", `- ${WONTDO_DETAIL}`);
      return line
        .replace(/^(\s*)- \[ \] /, `$1- ${OPEN_MARK} `)
        .replace(/^(\s*)- \[[xX]\] /, `$1- ${DONE_MARK} `)
        .replace(/^(\s*)- \[-\] /, `$1- ${WONTDO_MARK} `);
    })
    .join("\n");
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

/** Turns each box marker in rendered Today HTML into a button carrying its
 * index, counted in file order like setTodayItem (server/manager.ts) counts
 * the items it marks. */
export function tickBoxes(html: string): string {
  let i = 0;
  return html.replace(/<li>\uE003/g, '<li class="today-wontdo">').replace(/[\uE000-\uE002]/g, (mark) => {
    const [cls, glyph, label] =
      mark === DONE_MARK ? [" done", "☑", "done"] : mark === WONTDO_MARK ? [" wontdo", "☒", "won't do"] : ["", "☐", "open"];
    return (
      `<button class="today-tick${cls}" data-item="${i++}" aria-label="${label}: click to tick, double-click for won't do" ` +
      `title="Click to tick, double-click for won't do">${glyph}</button>`
    );
  });
}

/** What a click (`clicks` 1) or double-click (2) on a box makes an item. */
export function nextTodayState(now: TodayItemState, clicks: 1 | 2): TodayItemState {
  if (clicks === 2) return now === "wontdo" ? "open" : "wontdo";
  return now === "open" ? "done" : "open";
}

/** The sessions the open items name, in list order, each once. */
export function openItemSessions(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split("\n")) {
    if (!/^\s*- \[ \] /.test(line)) continue;
    const m = line.match(/\(session: ([^)]+)\)/);
    if (m && !out.includes(m[1].trim())) out.push(m[1].trim());
  }
  return out;
}

/** The session after `current` in the open items, or null at the end. */
export function nextItemSession(md: string, current: string): string | null {
  const list = openItemSessions(md);
  const at = list.indexOf(current);
  return list[at + 1] ?? null;
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
  onRefresh,
  onOpenSession,
  header,
  terminal,
}: {
  foxRunning: boolean;
  onStartDay: () => Promise<void>;
  /** Fox redoes the list from a fresh digest, while it's running. */
  onRefresh: () => Promise<void>;
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
      await (foxRunning ? onRefresh() : onStartDay());
    } finally {
      setStarting(false);
    }
  };

  const tick = async (item: number, clicks: 1 | 2) => {
    const now = todayItems(today?.content ?? "")[item];
    if (!now) return;
    try {
      setToday(
        await api<{ content: string; writtenAt: number }>("/api/manager/today/mark", {
          method: "POST",
          body: JSON.stringify({ item, text: now.text, state: nextTodayState(now.state, clicks) }),
        }),
      );
    } catch {
      // Fox rewrote the list after it was shown, so nothing was flipped: show the new one.
      api<{ content: string; writtenAt: number }>("/api/manager/today").then(setToday).catch(() => {});
    }
  };

  // A click waits out the double-click window, so a double-click doesn't tick first.
  const pendingClick = useRef<{ item: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const onBox = (item: number, detail: number) => {
    const pending = pendingClick.current;
    pendingClick.current = null;
    if (pending) {
      clearTimeout(pending.timer);
      // A click on another box lands now rather than being dropped.
      if (pending.item !== item) void tick(pending.item, 1);
    }
    if (detail >= 2) return void tick(item, 2);
    pendingClick.current = {
      item,
      timer: setTimeout(() => {
        pendingClick.current = null;
        void tick(item, 1);
      }, 250),
    };
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
          <button
            className="btn btn-ghost-outline today-start"
            disabled={starting}
            onClick={start}
            title={
              foxRunning
                ? "Refresh: Tanuki sweeps your inbox and Fox updates the list. Click it any time in the day."
                : "Start my day: Fox reads every session, your PRs, and Linear, and makes today's list"
            }
          >
            {foxRunning ? (starting ? "refreshing…" : "↻ refresh") : starting ? "starting…" : "☀ start my day"}
          </button>
        </div>
        {content ? (
          <div
            className="pr-info-scroll md today-list"
            onClick={(e) => {
              const target = e.target as HTMLElement;
              const item = target.closest<HTMLElement>(".today-tick")?.dataset.item;
              if (item !== undefined) return onBox(Number(item), e.detail);
              const name = target.closest<HTMLElement>(".today-session")?.dataset.session;
              if (name) onOpenSession(name);
            }}
            dangerouslySetInnerHTML={{ __html: tickBoxes(linkSessions(renderMarkdown(todayMarkdown(content)))) }}
          />
        ) : starting ? (
          <div className="loading-row today-empty">
            <Fox pose="walk" size={20} /> Fox is reading every session, your PRs, and Linear…
          </div>
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
