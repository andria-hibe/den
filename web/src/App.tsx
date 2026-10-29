import { useCallback, useEffect, useRef, useState } from "react";
import { WorkPanel } from "./WorkPanel.tsx";
import { NewSessionDialog } from "./NewSessionDialog.tsx";
import { NotepadPane } from "./NotepadPane.tsx";
import { SpendChip } from "./SpendChip.tsx";
import { LedgerChip } from "./LedgerChip.tsx";
import { TodayView, nextItemSession, openItemSessions } from "./TodayView.tsx";
import { Critter } from "./Critter.tsx";
import { ClockOutDialog } from "./ClockOutDialog.tsx";
import { TicketDialog } from "./TicketDialog.tsx";
import { PrDialog, type PreReview } from "./PrDialog.tsx";
import { PrReviewView, PrMyView } from "./PrViews.tsx";
import { OwnPrToggle } from "./OwnPrToggle.tsx";
import { FreshStartButton } from "./FreshStartButton.tsx";
import { Fox } from "./Fox.tsx";
import { Splitter, clamp } from "./Splitter.tsx";
import { usePersistentNumber, usePersistentString } from "./usePersistent.ts";
import { api } from "./api.ts";
import { TerminalView } from "./TerminalView.tsx";
import { AppRunButton, SetupButton, type AppRunner } from "./AppRunButton.tsx";
import { SessionRail } from "./SessionRail.tsx";
import { TicketLookView } from "./TicketLookView.tsx";
import { WorkLinkChips } from "./WorkLinkChips.tsx";
import { deriveFoxPose, foxReasons, isUrgentUnstarted, FOX_POSES, STATUS_TITLE } from "./foxPose.ts";
import { useRovingFocus } from "./useRovingFocus.ts";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts.ts";
import { useNotifications } from "./useNotifications.ts";
import { useSessions } from "./useSessions.ts";
import { useWorkData } from "./WorkData.tsx";
import type { PullRequest } from "../../server/github.ts";
import type { LinearIssue } from "../../server/linear.ts";
import { cleanupPrompt, denPrompt, ticketBrief, ticketDetails, ticketNotesSeed, ticketPrompt } from "./prompts.ts";
import { WorktreeCleanupDialog, type StackToStop } from "./WorktreeCleanupDialog.tsx";
import type { WorktreeInfo } from "../../server/git.ts";
import type { SessionMeta } from "../../server/sessions.ts";
import { COLORS } from "../../shared/colors.ts";
import { canStartFresh } from "../../shared/handover.ts";

// Modifier shown in the shortcuts hint.
const MOD =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
    ? "⌘"
    : "Ctrl";

export function App() {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // What the session just closed left behind (worktree, running stack), offered for cleanup.
  const [cleanup, setCleanup] = useState<{ worktree: WorktreeInfo | null; stack: StackToStop | null } | null>(null);

  const {
    sessions,
    activeId,
    shellTab,
    setShellTab,
    addSession,
    startDay,
    patch,
    restartSession,
    restartFresh,
    closeSession,
    setHandover,
    setKeepAlive,
    setOwned,
    addShellTab,
    launchApp,
    stopApp,
    closeShellTab,
    reorderRail,
    markExited,
    selectSession,
    applyTitle,
  } = useSessions({ editingId, onError: setErrMsg });

  // Close a session, then offer to clean up what it leaves behind (#15, #28):
  // its checkout's stack if one is still up, and the worktree when den made it
  // and no other session uses it.
  const closeAndOfferCleanup = async (id: string) => {
    const s = sessions.find((x) => x.id === id);
    const cwd = s?.cwd;
    // Ask about the stack while the session still exists; runn status takes a
    // moment, so it runs alongside the close.
    const stackQuery =
      s && s.role === "main"
        ? api<AppRunner>(`/api/app/runner?sessionId=${encodeURIComponent(id)}`).catch(() => null)
        : Promise.resolve(null);
    await closeSession(id);
    if (!cwd) return;
    const runner = await stackQuery;
    const stack: StackToStop | null =
      runner?.kind === "runn" && runner.stopCommand && (runner.containersUp ?? 0) > 0
        ? { dir: runner.dir, name: runner.name, command: runner.stopCommand, containersUp: runner.containersUp ?? 0 }
        : null;
    let worktree: WorktreeInfo | null = null;
    try {
      const info = await api<WorktreeInfo>(`/api/git/worktree?path=${encodeURIComponent(cwd)}`);
      if (info.den && !info.inUse) worktree = info;
    } catch {
      // not a worktree den knows about
    }
    // A stack is only offered for a checkout nothing else is open in.
    const othersHere = sessions.some((x) => x.groupId !== s?.groupId && x.cwd === cwd);
    if (worktree || (stack && !othersHere)) setCleanup({ worktree, stack: othersHere ? null : stack });
  };

  const work = useWorkData();
  const [clockingOut, setClockingOut] = useState(false);
  const closeClockOut = useCallback(() => setClockingOut(false), []);
  const prs = work.flatPrs;
  const issues = work.issues;
  // A PR I'm only reviewing that fails CI doesn't count: the server clears its
  // needsAttention.
  const foxInput = {
    prNeedsMe: prs.some((p) => p.needsAttention),
    prCount: prs.length,
    linearNotifs: work.linearNotifs,
    urgentTickets: work.issues.filter(isUrgentUnstarted).length,
  };
  const statusPose = deriveFoxPose(foxInput);
  const reasons = foxReasons(foxInput);
  const statusTitle = reasons.length ? `something needs you: ${reasons.join(", ")}` : STATUS_TITLE[statusPose];
  const [foxPopOpen, setFoxPopOpen] = useState(false);
  const foxPopRef = useRef<HTMLSpanElement>(null);
  // Last element the arrow-key roving focus landed on (survives re-renders).
  const navRef = useRef<HTMLElement | null>(null);
  const [ticketModal, setTicketModal] = useState<{
    issue: LinearIssue;
    startAtWork: boolean;
  } | null>(null);
  const [prModal, setPrModal] = useState<PullRequest | null>(null);
  // The PR whose review session should start on its own, and how (#11).
  const [autoReviewPr, setAutoReviewPr] = useState<{ pr: number; mode: "full" | "guide" } | null>(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  useEffect(() => setColorPickerOpen(false), [activeId]);
  const [workRepoRoot, setWorkRepoRoot] = useState<string>("");
  const [denRoot, setDenRoot] = useState<string>("");

  useEffect(() => {
    api<{ workRepo?: string; den?: string }>("/api/fs/roots")
      .then((d) => {
        setWorkRepoRoot(d.workRepo ?? "");
        setDenRoot(d.den ?? "");
      })
      .catch(() => {});
  }, []);

  const [railW, setRailW] = usePersistentNumber("den.railW", 240);
  const [workW, setWorkW] = usePersistentNumber("den.workW", 300);
  // The work panel folds to a strip of counts, for a small screen.
  const [workFold, setWorkFold] = usePersistentString("den.workFold", "open", ["open", "folded"] as const);
  const toggleWork = () => setWorkFold((f) => (f === "open" ? "folded" : "open"));
  const [mainFrac, setMainFrac] = usePersistentNumber("den.wsMainFrac", 0.6);
  const [shellFrac, setShellFrac] = usePersistentNumber("den.wsShellFrac", 0.5);
  const wsRef = useRef<HTMLDivElement>(null);
  const wsBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!foxPopOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!foxPopRef.current?.contains(e.target as Node)) setFoxPopOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFoxPopOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [foxPopOpen]);

  useRovingFocus(navRef);

  useNotifications({
    sessions,
    activeId,
    prsReady: work.prs !== null,
    prsNeedingAttention: prs.filter((p) => p.needsAttention),
  });

  // The colour of the session working on a ticket / PR, to tint its work card.
  const hintEq = (a?: string | null, b?: string | null) =>
    !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const sessionColor = (match: (s: SessionMeta) => boolean) => {
    const mains = sessions.filter((s) => s.role === "main" && match(s));
    return (mains.find((s) => s.status === "running") ?? mains[0])?.color;
  };
  const ticketColor = (identifier: string, hint?: string) =>
    sessionColor((s) => s.ticket === identifier || hintEq(s.ticketHint, hint));
  const prColor = (repo: string, number: number, hint?: string) =>
    sessionColor(
      (s) => (s.pr === number && s.prRepo === repo) || hintEq(s.ticketHint, hint),
    );

  useEffect(() => {
    if (!errMsg) return;
    const t = setTimeout(() => setErrMsg(null), 9000);
    return () => clearTimeout(t);
  }, [errMsg]);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  // One rail row per workspace.
  // The Manager's Today row stays at the top of the rail (#46).
  const rail = sessions
    .filter((s) => s.role === "main")
    .sort((a, b) => Number(b.view === "manager") - Number(a.view === "manager"));
  const manager = rail.find((s) => s.view === "manager");
  // The workspace's active shell tab, else its first when unset or closed.
  const groupShells =
    active && !active.shell
      ? sessions.filter(
          (s) => s.groupId === active.groupId && s.role === "shell",
        )
      : [];
  const activeShell =
    groupShells.find((s) => s.id === shellTab[active?.groupId ?? ""]) ??
    groupShells[0] ??
    null;

  const commitRename = (id: string) => {
    const name = draft.trim();
    if (name) patch(id, { name });
    setEditingId(null);
  };

  useKeyboardShortcuts({
    rail,
    activeId,
    blocked: showNew || !!ticketModal || !!prModal || !!cleanup || editingId !== null,
    onNewClaude: () => setShowNew(true),
    onNewShell: () => addSession({ shell: true }),
    onClose: closeAndOfferCleanup,
    onSelect: selectSession,
    onToggleWork: toggleWork,
  });

  // --- Linear ticket → look / work ---
  // Reuse an existing session for the ticket (by explicit ticket or branch hint)
  // so we never spin up duplicate sessions/branches for the same issue.
  const sessionForTicket = (issue: LinearIssue, opts?: { work?: boolean }) =>
    sessions.find(
      (s) =>
        s.role === "main" &&
        (opts?.work ? !s.look : true) &&
        (s.ticket === issue.identifier ||
          (!!issue.ticketHint && s.ticketHint === issue.ticketHint)),
    );

  const openTicket = (issue: LinearIssue) => {
    const existing = sessionForTicket(issue);
    if (existing) {
      selectSession(existing.id);
      return;
    }
    setTicketModal({ issue, startAtWork: false });
  };

  const lookAtTicket = (issue: LinearIssue) => {
    setTicketModal(null);
    const existing = sessionForTicket(issue);
    if (existing) {
      selectSession(existing.id);
      return;
    }
    addSession({
      cwd: workRepoRoot || undefined,
      ticket: issue.identifier,
      look: true,
      // Ticket id is shown by the chip, so keep the title to just the summary.
      name: issue.title,
      // Saved beside the session so its system prompt can point at the ticket.
      notepadSeed: ticketBrief(issue),
    });
  };

  const workOnTicket = (issue: LinearIssue, env: "local" | "worktree", base: string | null) => {
    setTicketModal(null);
    const existing = sessionForTicket(issue, { work: true });
    if (existing) {
      selectSession(existing.id);
      return;
    }
    addSession({
      ticket: issue.identifier,
      branch: issue.branchName,
      env,
      base: base ?? undefined,
      name: issue.title,
      notepadSeed: ticketNotesSeed(issue),
      notepadTicket: ticketDetails(issue),
      initialPrompt: ticketPrompt(issue),
    });
  };

  // --- Edit den itself ---
  // The sentinel ticket gives race-safe reuse (one editor at a time) and a
  // locked title.
  const DEN_TICKET = "den:self-edit";

  const openDenEditor = () => {
    if (!denRoot) {
      setErrMsg("couldn't locate the den source repo");
      return;
    }
    const existing = sessions.find(
      (s) => s.role === "main" && s.status === "running" && s.ticket === DEN_TICKET,
    );
    if (existing) {
      selectSession(existing.id);
      return;
    }
    addSession({
      cwd: denRoot,
      ticket: DEN_TICKET,
      name: "🦊 edit den",
      // No seed: the empty handover every workspace gets, plus the initial prompt.
      initialPrompt: denPrompt(),
    });
  };

  // --- Clean up the work repo (#29) ---
  // The sentinel ticket reuses one workspace, like the den editor.
  const CLEANUP_TICKET = "den:cleanup";
  const openCleanup = async () => {
    const existing = sessions.find(
      (s) => s.role === "main" && s.status === "running" && s.ticket === CLEANUP_TICKET,
    );
    if (existing) {
      selectSession(existing.id);
      return;
    }
    try {
      const { skill, cwd } = await api<{ skill: string | null; cwd: string }>("/api/cleanup");
      addSession({ cwd, ticket: CLEANUP_TICKET, name: "🧹 clean up", initialPrompt: cleanupPrompt(skill) });
    } catch (e) {
      setErrMsg((e as Error).message);
    }
  };

  // The sessions Fox's open Today items name, so a session header offers
  // "next" only while it's on the list.
  const [todaySessions, setTodaySessions] = useState<string[]>([]);
  const foxUp = manager?.status === "running";
  useEffect(() => {
    if (!foxUp) {
      setTodaySessions([]);
      return;
    }
    let stop = false;
    const load = () =>
      api<{ content: string }>("/api/manager/today")
        .then((d) => !stop && setTodaySessions(openItemSessions(d.content)))
        .catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [foxUp]);

  // Going through the Today list one item at a time (#46): on to the next
  // open item's session, or back to Today after the last.
  const goToday = () => manager && selectSession(manager.id);
  const goNextItem = async (current: string) => {
    try {
      const { content } = await api<{ content: string }>("/api/manager/today");
      const next = nextItemSession(content, current);
      const target = next ? rail.find((r) => r.name === next) : undefined;
      if (target) selectSession(target.id);
      else goToday();
    } catch {
      goToday();
    }
  };

  // A sprite in place of a session's colour dot: Fox (there's only one), and
  // a kit for each ticket or PR session (a ticket look included),
  // its scarf in the session's colour, and Owl for a review.
  const sessionIcon = (s: SessionMeta, size: number) => {
    if (s.view === "manager") return <Fox pose="sit" size={size} bust />;
    if (s.shell) return null;
    if (s.view === "review") return <Critter kind="owl" size={size} bust />;
    return <Critter kind="kit" size={size} tint={s.color} bust />;
  };

  const renderHeader = (s: SessionMeta, opts?: { workspace?: boolean }) => (
    <div className="term-header">
      {s.view === "manager" ? (
        <span className="fox-dot">{sessionIcon(s, 22)}</span>
      ) : (
        <span className="color-picker">
          {sessionIcon(s, 22) ? (
            <button
              className="fox-dot icon-btn"
              title="recolour (the scarf)"
              onClick={() => setColorPickerOpen((o) => !o)}
            >
              {sessionIcon(s, 22)}
            </button>
          ) : (
            <button
              className="dot dot-btn"
              style={{ background: s.color }}
              title="recolour"
              onClick={() => setColorPickerOpen((o) => !o)}
            />
          )}
          {colorPickerOpen && (
            <span className="swatches">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch ${c === s.color ? "on" : ""}`}
                  style={{ background: c }}
                  title="recolour"
                  onClick={() => {
                    patch(s.id, { color: c });
                    setColorPickerOpen(false);
                  }}
                />
              ))}
            </span>
          )}
        </span>
      )}
      <strong className="term-name" title={s.name}>
        {s.name}
      </strong>
      <span className="term-cwd" title={s.cwd}>
        {s.cwd.replace(/^\/Users\/[^/]+/, "~")}
      </span>
      {s.branch && (
        <span className="term-branch" title="git branch">
          ⎇ {s.branch}
        </span>
      )}
      <WorkLinkChips s={s} issues={issues} prs={prs} />
      <span className="term-actions">
        {!s.shell && <SpendChip sessionId={s.id} />}
        {s.view === "review" && (
          <OwnPrToggle
            owned={s.owned}
            running={s.status === "running"}
            onSwitch={(on) => setOwned(s.id, on)}
          />
        )}
        {opts?.workspace && (
          <SetupButton
            sessionId={s.id}
            status={s.status}
            onSetup={(id) => launchApp(id, "setup")}
          />
        )}
        {opts?.workspace && (
          <AppRunButton
            sessionId={s.id}
            status={s.status}
            onLaunch={launchApp}
            onStop={stopApp}
          />
        )}
        {opts?.workspace && s.ticket === DEN_TICKET && (
          // Vite's dev server, not this instance's origin: in the packaged app
          // that origin is the installed build, not the edits being made here.
          <a
            className="btn btn-ghost-outline app-run-btn running"
            href="http://localhost:5173"
            target="_blank"
            rel="noreferrer"
            title="open den's latest iteration (the dev server) — needs `npm run dev` running on :5173"
          >
            ▶ dev
          </a>
        )}
        {s.view !== "manager" && todaySessions.includes(s.name) && (
          <button
            className="btn btn-ghost-outline restart-btn"
            onClick={() => goNextItem(s.name)}
            title="On to the next session on Fox's Today list (back to Today after the last)"
          >
            next ›
          </button>
        )}
        {canStartFresh(s) && (
          <FreshStartButton running={s.status === "running"} onFresh={() => restartFresh(s.id)} />
        )}
        {canStartFresh(s) && (
          <button
            className={`btn btn-ghost-outline restart-btn${s.keepAlive ? " pinned" : ""}`}
            onClick={() => setKeepAlive(s.id, !s.keepAlive)}
            title={
              s.keepAlive
                ? "Pinned: Clock out leaves this session running and it keeps its conversation. Click to unpin."
                : "Pin to keep this session running through Clock out, in the same conversation"
            }
          >
            {s.keepAlive ? "📌 pinned" : "📌"}
          </button>
        )}
        {s.status === "exited" && (
          <button
            className="btn btn-ghost-outline restart-btn"
            onClick={() => restartSession(s.id)}
            title="restart this session"
          >
            ↻ restart
          </button>
        )}
      </span>
    </div>
  );

  // --- GitHub PR → review / edit ---
  const sessionForPr = (pr: PullRequest) =>
    sessions.find(
      (s) => s.role === "main" && s.pr === pr.number && s.prRepo === pr.repo,
    );

  const openPr = (pr: PullRequest) => {
    const existing = sessionForPr(pr);
    if (existing) {
      selectSession(existing.id);
      return;
    }
    setPrModal(pr);
  };

  const reviewPr = (pr: PullRequest, opts: { preReview: PreReview; owned: boolean }) => {
    setPrModal(null);
    const existing = sessionForPr(pr);
    if (existing) {
      selectSession(existing.id);
      return;
    }
    if (opts.preReview !== "none") setAutoReviewPr({ pr: pr.number, mode: opts.preReview });
    addSession({
      view: "review",
      owned: opts.owned,
      pr: pr.number,
      prRepo: pr.repo,
      env: "worktree",
      branch: pr.branch,
      // PR number is shown by the chip, so keep the title to just the summary.
      name: pr.title,
    });
  };

  const editMyPr = (pr: PullRequest, env: "local" | "worktree") => {
    setPrModal(null);
    const existing = sessionForPr(pr);
    if (existing) {
      selectSession(existing.id);
      return;
    }
    addSession({
      view: "mypr",
      pr: pr.number,
      prRepo: pr.repo,
      env,
      branch: pr.branch,
      name: pr.title,
    });
  };

  return (
    <div className="app">
      <div
        className="topbar"
        style={
          active
            ? {
                background: `linear-gradient(100deg, ${active.color}, color-mix(in srgb, ${active.color}, #ffffff 48%))`,
              }
            : undefined
        }
      >
        {denRoot ? (
          <button
            className="brand-fox"
            onClick={openDenEditor}
            title="edit den — open a Claude session to change this app"
            aria-label="edit den"
          >
            <Critter kind="kit" size={38} />
          </button>
        ) : (
          <Critter kind="kit" size={38} />
        )}
        <span className="wordmark" tabIndex={0}>
          den
          <div className="shortcuts-pop" role="tooltip">
            <div className="shortcuts-title">keyboard shortcuts</div>
            <ul>
              <li>
                <span className="keys"><kbd>{MOD}</kbd><kbd>N</kbd></span>
                <span>new claude session</span>
              </li>
              <li>
                <span className="keys"><kbd>{MOD}</kbd><kbd>T</kbd></span>
                <span>new shell</span>
              </li>
              <li>
                <span className="keys"><kbd>{MOD}</kbd><kbd>1</kbd>–<kbd>9</kbd></span>
                <span>switch session</span>
              </li>
              <li>
                <span className="keys"><kbd>{MOD}</kbd><kbd>W</kbd></span>
                <span>close session</span>
              </li>
              <li>
                <span className="keys"><kbd>{MOD}</kbd><kbd>\\</kbd></span>
                <span>fold the work panel</span>
              </li>
              <li>
                <span className="keys"><kbd>alt</kbd><kbd>↑</kbd>/<kbd>↓</kbd></span>
                <span>reorder session</span>
              </li>
            </ul>
          </div>
        </span>
        {active && (
          <span className="topbar-title" title={active.name}>
            {sessionIcon(active, 22) ? (
              <span className="fox-dot">{sessionIcon(active, 22)}</span>
            ) : (
              <span className="dot" style={{ background: active.color }} />
            )}
            <span className="topbar-name">{active.name}</span>
          </span>
        )}
        <span className="topbar-spacer" />
        {/* One slot for the day: start it until Fox is up, then clock out. */}
        {manager?.status !== "running" ? (
            <button className="btn topbar-day" onClick={startDay} title="Start my day: Fox reads every session, your PRs, and Linear, and makes today's list">
              ☀ start
            </button>
          ) : (
            <button className="btn topbar-day" onClick={() => setClockingOut(true)} title="Clock out: Hedgehog updates each session's handover and ends its chat for the night">
              ☾ clock out
            </button>
          )}
        <LedgerChip mouse />
        <span className="status-fox-wrap" ref={foxPopRef}>
          <button
            className="status-fox"
            title={statusTitle}
            aria-label={`Status: ${statusTitle} — click to see all foxes`}
            aria-expanded={foxPopOpen}
            onClick={() => setFoxPopOpen((o) => !o)}
          >
            <Fox pose={statusPose} size={38} />
          </button>
          {foxPopOpen && (
            <div className="fox-pop" role="dialog" aria-label="den's foxes">
              <div className="fox-pop-title">den&apos;s foxes</div>
              <div className="fox-pop-grid">
                {FOX_POSES.map(({ pose, label, note }) => (
                  <div
                    key={pose}
                    className={`fox-pop-item${pose === statusPose ? " current" : ""}`}
                  >
                    <div className="fox-pop-stage">
                      {pose === "sleep" ? (
                        <span className="sleep-fox">
                          <Fox pose="sleep" size={52} className="fox-bob" />
                          <span className="zzz z1">z</span>
                          <span className="zzz z2">z</span>
                          <span className="zzz z3">z</span>
                        </span>
                      ) : (
                        <Fox pose={pose} size={52} />
                      )}
                    </div>
                    <div className="fox-pop-name">
                      {label}
                      {pose === statusPose && (
                        <span className="fox-pop-now">now</span>
                      )}
                    </div>
                    <div className="fox-pop-note">{note}</div>
                  </div>
                ))}
              </div>
              <a
                className="fox-pop-arch"
                href="/architecture.svg"
                target="_blank"
                rel="noreferrer"
                title="how den fits together — renderer, server, PTYs, and everything they touch"
              >
                🗺 den&apos;s architecture ↗
              </a>
            </div>
          )}
        </span>
      </div>

      <div className="app-body">
      {/* Left: sessions */}
      <SessionRail
        rail={rail}
        renderIcon={(s) => sessionIcon(s, 22)}
        activeId={activeId}
        width={railW}
        editingId={editingId}
        draft={draft}
        onDraftChange={setDraft}
        onStartRename={(id, name) => {
          setEditingId(id);
          setDraft(name);
        }}
        onCommitRename={commitRename}
        onCancelRename={() => setEditingId(null)}
        onSelect={selectSession}
        onRestart={restartSession}
        onClose={closeAndOfferCleanup}
        onNewClaude={() => setShowNew(true)}
        onNewShell={() => addSession({ shell: true })}
        onCleanup={openCleanup}
        onReorder={reorderRail}
        renderLinks={(s) => (
          <WorkLinkChips s={s} issues={issues} prs={prs} wrapClass="session-links" />
        )}
      />

      <Splitter
        dir="x"
        onDrag={(d) => setRailW((w) => clamp(w + d, 170, 480))}
      />

      {/* Center: terminal / workspace */}
      <main className="panel term-wrap" data-nav-center tabIndex={-1}>
        {!active ? (
          <div className="empty-terminal">
            <div className="sleep-fox">
              <Fox pose="sleep" size={150} className="fox-bob" />
              <span className="zzz z1">z</span>
              <span className="zzz z2">z</span>
              <span className="zzz z3">z</span>
            </div>
            <div className="placeholder">the den is quiet — start a session 🌙</div>
          </div>
        ) : active.view === "manager" ? (
          <TodayView
            key={active.id}
            foxRunning={active.status === "running"}
            onStartDay={startDay}
            onOpenSession={(name) => {
              const target = rail.find((r) => r.name === name);
              if (target) selectSession(target.id);
            }}
            header={renderHeader(active)}
            terminal={
              <TerminalView
                key={`${active.id}:${active.status}`}
                session={active}
                onExit={() => markExited(active.id)}
                onTitle={(name) => applyTitle(active.id, name)}
              />
            }
          />
        ) : active.view === "review" && active.pr && active.prRepo ? (
          <PrReviewView
            key={active.id}
            repo={active.prRepo}
            number={active.pr}
            sessionId={active.id}
            groupId={active.groupId}
            owned={active.owned}
            autoReview={autoReviewPr?.pr === active.pr ? autoReviewPr.mode : null}
            onAutoReviewStarted={() => setAutoReviewPr(null)}
            header={renderHeader(active)}
            terminal={
              <TerminalView
                key={`${active.id}:${active.status}`}
                session={active}
                onExit={() => markExited(active.id)}
                onTitle={(name) => applyTitle(active.id, name)}
              />
            }
          />
        ) : active.view === "mypr" && active.pr && active.prRepo ? (
          <PrMyView
            key={active.id}
            repo={active.prRepo}
            number={active.pr}
            sessionId={active.id}
            header={renderHeader(active)}
            terminal={
              <TerminalView
                key={`${active.id}:${active.status}`}
                session={active}
                onExit={() => markExited(active.id)}
                onTitle={(name) => applyTitle(active.id, name)}
              />
            }
          />
        ) : active.look ? (
          <TicketLookView
            key={active.id}
            ticketId={active.ticket}
            issues={issues}
            onWork={(issue) => setTicketModal({ issue, startAtWork: true })}
            header={renderHeader(active)}
            terminal={
              <TerminalView
                key={`${active.id}:${active.status}`}
                session={active}
                onExit={() => markExited(active.id)}
                onTitle={(name) => applyTitle(active.id, name)}
              />
            }
          />
        ) : active.shell ? (
          <>
            {renderHeader(active)}
            <TerminalView
              key={`${active.id}:${active.status}`}
              session={active}
              onExit={() => markExited(active.id)}
              onTitle={(name) => applyTitle(active.id, name)}
            />
          </>
        ) : (
          <div className="workspace" ref={wsRef}>
            <div className="ws-main" style={{ flex: `${mainFrac} 1 0` }}>
              {renderHeader(active, { workspace: true })}
              <TerminalView
                key={`${active.id}:${active.status}`}
                session={active}
                onExit={() => markExited(active.id)}
                onTitle={(name) => applyTitle(active.id, name)}
              />
            </div>
            <Splitter
              dir="y"
              onDrag={(d) => {
                const h = wsRef.current?.clientHeight ?? 1;
                setMainFrac((f) => clamp(f + d / h, 0.2, 0.85));
              }}
            />
            <div
              className="ws-bottom"
              ref={wsBottomRef}
              style={{ flex: `${1 - mainFrac} 1 0` }}
            >
              <div className="ws-pane ws-shell" style={{ flex: `${shellFrac} 1 0` }}>
                <div className="shell-tabs">
                  <span className="pane-label">🖥</span>
                  {groupShells.map((sh, i) => (
                    <span
                      key={sh.id}
                      className={`shell-tab${sh.id === activeShell?.id ? " active" : ""}`}
                      onClick={() =>
                        setShellTab((m) => ({ ...m, [active.groupId]: sh.id }))
                      }
                      title={`terminal ${i + 1}`}
                    >
                      <span
                        className="shell-tab-dot"
                        style={{ opacity: sh.status === "exited" ? 0.4 : 1 }}
                      />
                      term {i + 1}
                      {groupShells.length > 1 && (
                        <button
                          className="shell-tab-close"
                          title="close terminal"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeShellTab(sh.id, active.groupId);
                          }}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                  <button
                    className="shell-tab-add"
                    title="new terminal tab"
                    onClick={() => addShellTab(active.id, active.groupId)}
                  >
                    +
                  </button>
                </div>
                {activeShell ? (
                  <TerminalView
                    key={`${activeShell.id}:${activeShell.status}`}
                    session={activeShell}
                    onExit={() => markExited(activeShell.id)}
                    onTitle={() => {}}
                  />
                ) : (
                  <div className="placeholder">
                    no terminal — click + to open one
                  </div>
                )}
              </div>
              <Splitter
                dir="x"
                onDrag={(d) => {
                  const w = wsBottomRef.current?.clientWidth ?? 1;
                  setShellFrac((f) => clamp(f + d / w, 0.2, 0.85));
                }}
              />
              <div className="ws-pane ws-note" style={{ flex: `${1 - shellFrac} 1 0` }}>
                <NotepadPane
                  groupId={active.groupId}
                  handover={active.handover}
                  onHandover={(on) => setHandover(active.id, on)}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      {workFold === "folded" ? (
        <button
          className="panel work-strip"
          onClick={toggleWork}
          title={`Show the work panel (${MOD}+\\)`}
          aria-label="show the work panel"
        >
          <span className="work-strip-label">WORK</span>
          <span className="work-strip-count" title="PRs that need you">
            ⌥ {prs.filter((p) => p.needsAttention).length}
          </span>
          <span className="work-strip-count" title="unread in Linear">
            ◆ {work.linearNotifs}
          </span>
        </button>
      ) : (
        <>
          <Splitter dir="x" onDrag={(d) => setWorkW((w) => clamp(w - d, 220, 560))} />

          {/* Right: work — live GitHub PRs + Linear tickets */}
          <div className="work-col" style={{ width: workW }}>
            <WorkPanel
              onFold={toggleWork}
              foldTitle={`Fold the work panel (${MOD}+\\)`}
              onOpenTicket={openTicket}
              onOpenPr={openPr}
              ticketColor={ticketColor}
              prColor={prColor}
            />
          </div>
        </>
      )}
      </div>

      {showNew && (
        <NewSessionDialog
          onClose={() => setShowNew(false)}
          onCreate={(cwd) => {
            setShowNew(false);
            addSession({ cwd });
          }}
          onCreateWorktree={(branch, base) => {
            setShowNew(false);
            // Same path as a ticket's "Work on it": the server makes or reuses the worktree.
            addSession({ branch, env: "worktree", base: base ?? undefined });
          }}
          onResume={(cwd, resumeId) => {
            setShowNew(false);
            addSession({ cwd, resumeId });
          }}
        />
      )}

      {ticketModal && (
        <TicketDialog
          issue={ticketModal.issue}
          startAtWork={ticketModal.startAtWork}
          onClose={() => setTicketModal(null)}
          onLook={lookAtTicket}
          onWork={workOnTicket}
        />
      )}

      {prModal && (
        <PrDialog
          pr={prModal}
          onClose={() => setPrModal(null)}
          onReview={reviewPr}
          onEditMine={editMyPr}
        />
      )}

      {cleanup && (
        <WorktreeCleanupDialog
          worktree={cleanup.worktree}
          stack={cleanup.stack}
          onDone={() => setCleanup(null)}
          onError={(msg) => {
            setCleanup(null);
            setErrMsg(msg);
          }}
        />
      )}
      {clockingOut && <ClockOutDialog onDone={closeClockOut} onError={setErrMsg} />}
      {errMsg && (
        <div className="toast" onClick={() => setErrMsg(null)}>
          <span>⚠️ {errMsg}</span>
          <button className="toast-x">×</button>
        </div>
      )}
    </div>
  );
}
