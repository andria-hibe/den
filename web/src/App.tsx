import { useEffect, useRef, useState } from "react";
import { useTerminal } from "./useTerminal.ts";
import { WorkPanel } from "./WorkPanel.tsx";
import { NewSessionDialog } from "./NewSessionDialog.tsx";
import { NotepadPane } from "./NotepadPane.tsx";
import { TicketDialog } from "./TicketDialog.tsx";
import { PrDialog } from "./PrDialog.tsx";
import { PrReviewView, PrMyView } from "./PrViews.tsx";
import { renderMarkdown } from "./markdown.ts";
import { PixelFox } from "./PixelFox.tsx";
import { Fox } from "./Fox.tsx";
import type { FoxPose } from "./foxSprites.ts";
import { Splitter, usePersistentNumber, clamp } from "./Splitter.tsx";
import type { PullRequest } from "../../server/github.ts";
import type { LinearIssue } from "../../server/linear.ts";
import type { SessionMeta } from "../../server/sessions.ts";

const COLORS = ["#ffb7d5", "#cdb4f6", "#b8e6d4", "#b4d8f6", "#ffd9b0", "#fff0a8"];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  // Only set a JSON content-type when there's actually a body — Fastify rejects
  // an empty body when content-type is application/json (breaks DELETE).
  const headers = init?.body ? { "content-type": "application/json" } : undefined;
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.message || j?.error) msg = j.message || j.error;
    } catch {
      // no JSON body
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

function TerminalView({
  session,
  onExit,
  onTitle,
}: {
  session: SessionMeta;
  onExit: () => void;
  onTitle: (name: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useTerminal(hostRef, session.id, onExit, onTitle);
  return <div className="term-host" ref={hostRef} />;
}

export function App() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [statusPose, setStatusPose] = useState<FoxPose>("sit");
  const [ticketModal, setTicketModal] = useState<{
    issue: LinearIssue;
    startAtWork: boolean;
  } | null>(null);
  const [prModal, setPrModal] = useState<PullRequest | null>(null);
  const [autoReviewPr, setAutoReviewPr] = useState<number | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [runnRoot, setRunnRoot] = useState<string>("");

  useEffect(() => {
    fetch("/api/fs/roots")
      .then((r) => r.json())
      .then((d) => setRunnRoot(d.runn ?? ""))
      .catch(() => {});
  }, []);

  // Resizable panels (persisted).
  const [railW, setRailW] = usePersistentNumber("den.railW", 240);
  const [workW, setWorkW] = usePersistentNumber("den.workW", 300);
  const [mainFrac, setMainFrac] = usePersistentNumber("den.wsMainFrac", 0.6);
  const [shellFrac, setShellFrac] = usePersistentNumber("den.wsShellFrac", 0.5);
  const [lookFrac, setLookFrac] = usePersistentNumber("den.lookFrac", 0.42);
  const wsRef = useRef<HTMLDivElement>(null);
  const wsBottomRef = useRef<HTMLDivElement>(null);
  const lookRef = useRef<HTMLDivElement>(null);

  // PRs + Linear issues, used both for the topbar status fox and for linking a
  // session's branch to its ticket/PR.
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [issues, setIssues] = useState<LinearIssue[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/github/prs");
        if (!r.ok) return;
        const d = await r.json();
        if (!alive || d.error) return;
        const all: PullRequest[] = [...(d.authored ?? []), ...(d.reviewRequested ?? [])];
        setPrs(all);
        const trouble = all.some(
          (p) => p.checks === "failing" || p.review === "changes_requested",
        );
        setStatusPose(trouble ? "alert" : all.length ? "happy" : "sit");
      } catch {
        // leave as-is
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/linear/issues");
        if (!r.ok) return; // 409 when not connected
        const d = await r.json();
        if (alive && d.issues) setIssues(d.issues as LinearIssue[]);
      } catch {
        // leave as-is
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Match a session's branch ticket hint to a PR / Linear ticket.
  const prByHint = (hint: string | null) =>
    hint ? prs.find((p) => p.ticketHint?.toLowerCase() === hint) : undefined;
  const issueByHint = (hint: string | null) =>
    hint ? issues.find((i) => i.ticketHint.toLowerCase() === hint) : undefined;

  const STATUS_TITLE: Record<FoxPose, string> = {
    happy: "all your PRs look happy 🎉",
    alert: "a PR needs a look — failing check or changes requested",
    sit: "no open PRs right now",
    sleep: "",
    walk: "",
  };

  useEffect(() => {
    api<{ sessions: SessionMeta[] }>("/api/sessions")
      .then((d) => {
        setSessions(d.sessions);
        const mains = d.sessions.filter((s) => s.role === "main");
        const running = mains.find((s) => s.status === "running");
        setActiveId((running ?? mains[0])?.id ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!errMsg) return;
    const t = setTimeout(() => setErrMsg(null), 9000);
    return () => clearTimeout(t);
  }, [errMsg]);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  // Sessions shown in the rail (one per workspace); sub-shells are hidden.
  const rail = sessions.filter((s) => s.role === "main");
  // For a Claude workspace, its sibling shell pane.
  const shellPane =
    active && !active.shell
      ? sessions.find(
          (s) => s.groupId === active.groupId && s.role === "shell",
        )
      : null;

  const addSession = async (opts: {
    shell?: boolean;
    cwd?: string;
    resumeId?: string;
    ticket?: string;
    look?: boolean;
    branch?: string;
    env?: "local" | "worktree";
    name?: string;
    notepadSeed?: string;
    view?: "review" | "mypr";
    pr?: number;
    prRepo?: string;
    initialPrompt?: string;
  }) => {
    try {
      const meta = await api<SessionMeta>("/api/sessions", {
        method: "POST",
        body: JSON.stringify(opts),
      });
      // Refetch so a Claude workspace's sibling shell pane lands in state too.
      const d = await api<{ sessions: SessionMeta[] }>("/api/sessions");
      setSessions(d.sessions);
      setActiveId(meta.id);
    } catch (e) {
      setErrMsg((e as Error).message);
    }
  };

  const patch = async (id: string, body: { name?: string; color?: string }) => {
    const meta = await api<SessionMeta>(`/api/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    // A recolour applies to the whole workspace server-side; mirror that.
    setSessions((prev) =>
      prev.map((s) =>
        s.id === meta.id
          ? meta
          : body.color !== undefined && s.groupId === meta.groupId
            ? { ...s, color: body.color }
            : s,
      ),
    );
  };

  const closeSession = async (id: string) => {
    const groupId = sessions.find((s) => s.id === id)?.groupId;
    await api(`/api/sessions/${id}`, { method: "DELETE" });
    setSessions((prev) => {
      const next = prev.filter((s) => s.groupId !== groupId);
      if (activeId === id) {
        setActiveId(next.find((s) => s.role === "main")?.id ?? null);
      }
      return next;
    });
  };

  const commitRename = (id: string) => {
    const name = draft.trim();
    if (name) patch(id, { name });
    setEditingId(null);
  };

  const markExited = (id: string) =>
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: "exited" } : s)),
    );

  // Selecting a session views it — clear its attention nudge optimistically
  // (the server also clears it when the terminal re-attaches).
  const selectSession = (id: string) => {
    setActiveId(id);
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, attention: false } : s)),
    );
  };

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

  // Seed the workspace notepad with a summary of the ticket, so the session
  // starts with its context; Claude appends progress below.
  const ticketNotesSeed = (issue: LinearIssue) => {
    const parts = [
      `# ${issue.identifier}: ${issue.title}`,
      "",
      `**State:** ${issue.state.name}  ·  **Priority:** ${issue.priorityLabel}`,
    ];
    if (issue.branchName) parts.push(`**Branch:** \`${issue.branchName}\``);
    parts.push(
      `[Open in Linear](${issue.url})`,
      "",
      "## Ticket",
      "",
      issue.description?.trim() || "_(no description)_",
      "",
      "---",
      "",
      "## Progress",
      "",
    );
    return parts.join("\n");
  };

  // Claude's first message when you start work: the ticket + a request to
  // explain and propose before doing anything.
  const ticketPrompt = (issue: LinearIssue) =>
    [
      `I'm starting work on this Linear ticket:`,
      "",
      `${issue.identifier}: ${issue.title}`,
      `State: ${issue.state.name} · Priority: ${issue.priorityLabel}`,
      "",
      issue.description?.trim() || "(no description provided)",
      "",
      "Before writing any code: explain the issue in your own words and propose " +
        "a solution or approach. Don't make changes yet — I'll decide the next " +
        "step after your proposal.",
    ].join("\n");

  const openTicket = (issue: LinearIssue) => {
    const existing = sessionForTicket(issue);
    if (existing) {
      selectSession(existing.id); // already open — just switch to it
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
      cwd: runnRoot || undefined,
      ticket: issue.identifier,
      look: true,
      name: `${issue.identifier}: ${issue.title}`,
    });
  };

  const workOnTicket = (issue: LinearIssue, env: "local" | "worktree") => {
    setTicketModal(null);
    const existing = sessionForTicket(issue, { work: true });
    if (existing) {
      selectSession(existing.id); // reuse the working session/branch
      return;
    }
    addSession({
      ticket: issue.identifier,
      branch: issue.branchName,
      env,
      name: `${issue.identifier}: ${issue.title}`,
      notepadSeed: ticketNotesSeed(issue),
      initialPrompt: ticketPrompt(issue),
    });
  };

  // Terminal-set title (Claude/shell) for the active session — apply unless
  // the user is mid-rename of it.
  const applyTitle = (id: string, name: string) =>
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id && editingId !== id ? { ...s, name } : s,
      ),
    );

  const renderHeader = (s: SessionMeta) => (
    <div className="term-header">
      <span className="dot" style={{ background: s.color }} />
      <strong className="term-name" title={s.name}>
        {s.name}
      </strong>
      <span className="swatches">
        {COLORS.map((c) => (
          <button
            key={c}
            className={`swatch ${c === s.color ? "on" : ""}`}
            style={{ background: c }}
            title="recolour"
            onClick={() => patch(s.id, { color: c })}
          />
        ))}
      </span>
      <span className="term-cwd" title={s.cwd}>
        {s.cwd.replace(/^\/Users\/[^/]+/, "~")}
      </span>
      {s.branch && (
        <span className="term-branch" title="git branch">
          ⎇ {s.branch}
        </span>
      )}
      {renderWorkLinks(s.ticketHint)}
      <span style={{ marginLeft: "auto" }}>
        {s.shell ? "shell" : "claude"} · {s.status}
      </span>
    </div>
  );

  // Ticket / PR chips linking a session's branch to its work.
  const renderWorkLinks = (hint: string | null) => {
    const issue = issueByHint(hint);
    const pr = prByHint(hint);
    if (!issue && !pr) return null;
    const check = pr
      ? pr.checks === "passing"
        ? "✓"
        : pr.checks === "failing"
          ? "✕"
          : pr.checks === "pending"
            ? "◐"
            : ""
      : "";
    return (
      <>
        {issue && (
          <a
            className="link-chip issue"
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            title={issue.title}
            onClick={(e) => e.stopPropagation()}
          >
            {issue.identifier}
          </a>
        )}
        {pr && (
          <a
            className={`link-chip pr ${pr.checks}`}
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            title={pr.title}
            onClick={(e) => e.stopPropagation()}
          >
            PR #{pr.number} {check}
          </a>
        )}
      </>
    );
  };

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

  const reviewPr = (pr: PullRequest, opts: { preReview: boolean }) => {
    setPrModal(null);
    const existing = sessionForPr(pr);
    if (existing) {
      selectSession(existing.id);
      return;
    }
    if (opts.preReview) setAutoReviewPr(pr.number);
    addSession({
      view: "review",
      pr: pr.number,
      prRepo: pr.repo,
      env: "worktree",
      branch: pr.branch,
      name: `PR #${pr.number}: ${pr.title}`,
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
      name: `PR #${pr.number}: ${pr.title}`,
    });
  };

  // Ticket detail shown atop a "just looking" session.
  const renderTicketDetail = (ticketId: string | null) => {
    const issue = issues.find((i) => i.identifier === ticketId);
    return (
      <div className="ticket-detail">
        <div className="ticket-detail-head">
          {issue && (
            <span className="state-dot" style={{ background: issue.state.color }} />
          )}
          <strong>{ticketId}</strong>
          {issue && <span className="issue-state">{issue.state.name}</span>}
          {issue && (
            <a
              className="link-chip issue"
              href={issue.url}
              target="_blank"
              rel="noreferrer"
            >
              Linear ↗
            </a>
          )}
          <button
            className="btn btn-primary"
            style={{ marginLeft: "auto" }}
            disabled={!issue}
            onClick={() => issue && setTicketModal({ issue, startAtWork: true })}
          >
            work on it
          </button>
        </div>
        {issue ? (
          <div className="ticket-detail-body">
            <div className="ticket-detail-title">{issue.title}</div>
            {issue.description ? (
              <div
                className="ticket-detail-desc md"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(issue.description),
                }}
              />
            ) : (
              <div className="placeholder">No description.</div>
            )}
          </div>
        ) : (
          <div className="placeholder" style={{ padding: 12 }}>
            Ticket details aren't in your assigned list right now.
          </div>
        )}
      </div>
    );
  };

  // Poll so auto-titles (and exits) on background sessions reach the rail.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const d = await api<{ sessions: SessionMeta[] }>("/api/sessions");
        setSessions((prev) =>
          prev.map((loc) => {
            const s = d.sessions.find((x) => x.id === loc.id);
            return s && editingId !== loc.id
              ? {
                  ...loc,
                  name: s.name,
                  status: s.status,
                  color: s.color,
                  attention: s.attention,
                }
              : loc;
          }),
        );
      } catch {
        // transient; try again next tick
      }
    }, 4000);
    return () => clearInterval(t);
  }, [editingId]);

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
        <PixelFox size={30} />
        <span className="wordmark">den</span>
        {active && (
          <span className="topbar-title" title={active.cwd}>
            <span className="dot" style={{ background: active.color }} />
            {active.name}
            <span className="topbar-kind">
              {active.shell ? "shell" : "claude"}
            </span>
          </span>
        )}
        <span
          className="status-fox"
          title={STATUS_TITLE[statusPose]}
          aria-label={STATUS_TITLE[statusPose]}
        >
          <Fox pose={statusPose} size={38} />
        </span>
      </div>

      <div className="app-body">
      {/* Left: sessions */}
      <aside className="panel rail" style={{ width: railW }}>
        <h2>sessions</h2>
        <div className="session-list">
        {rail.map((s) => {
          const links = renderWorkLinks(s.ticketHint);
          return (
          <div
            key={s.id}
            className={`session ${s.id === activeId ? "active" : ""} ${s.attention ? "attn-row" : ""}`}
            onClick={() => selectSession(s.id)}
          >
            <span
              className="dot"
              style={{ background: s.color, opacity: s.status === "exited" ? 0.4 : 1 }}
            />
            {editingId === s.id ? (
              <input
                className="rename-input"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitRename(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(s.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="label"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingId(s.id);
                  setDraft(s.name);
                }}
                title={`${s.name}\n(double-click to rename)`}
              >
                {s.name}
              </span>
            )}
            {s.attention && (
              <span className="attn-dot" title="waiting for you">
                !
              </span>
            )}
            <span className="status">{s.status === "running" ? "●" : "○"}</span>
            <button
              className="session-close"
              title="close session"
              onClick={(e) => {
                e.stopPropagation();
                closeSession(s.id);
              }}
            >
              ×
            </button>
            {links && <span className="session-links">{links}</span>}
          </div>
          );
        })}
        {rail.length === 0 && (
          <div className="placeholder">no sessions yet — start one below 🌱</div>
        )}
        </div>
        <div className="rail-actions">
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            + claude
          </button>
          <button className="btn btn-ghost-outline" onClick={() => addSession({ shell: true })}>
            + shell
          </button>
        </div>
      </aside>

      <Splitter
        dir="x"
        onDrag={(d) => setRailW((w) => clamp(w + d, 170, 480))}
      />

      {/* Center: terminal / workspace */}
      <main className="panel term-wrap">
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
        ) : active.view === "review" && active.pr && active.prRepo ? (
          <PrReviewView
            key={active.id}
            repo={active.prRepo}
            number={active.pr}
            autoReview={autoReviewPr === active.pr}
            header={renderHeader(active)}
            terminal={
              <TerminalView
                key={active.id}
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
            header={renderHeader(active)}
            terminal={
              <TerminalView
                key={active.id}
                session={active}
                onExit={() => markExited(active.id)}
                onTitle={(name) => applyTitle(active.id, name)}
              />
            }
          />
        ) : active.look ? (
          <div className="look-view" ref={lookRef}>
            <div className="ws-pane" style={{ flex: `${lookFrac} 1 0` }}>
              {renderTicketDetail(active.ticket)}
            </div>
            <Splitter
              dir="y"
              onDrag={(d) => {
                const h = lookRef.current?.clientHeight ?? 1;
                setLookFrac((f) => clamp(f + d / h, 0.15, 0.8));
              }}
            />
            <div
              className="ws-main"
              style={{ flex: `${1 - lookFrac} 1 0` }}
            >
              {renderHeader(active)}
              <TerminalView
                key={active.id}
                session={active}
                onExit={() => markExited(active.id)}
                onTitle={(name) => applyTitle(active.id, name)}
              />
            </div>
          </div>
        ) : active.shell ? (
          <>
            {renderHeader(active)}
            <TerminalView
              key={active.id}
              session={active}
              onExit={() => markExited(active.id)}
              onTitle={(name) => applyTitle(active.id, name)}
            />
          </>
        ) : (
          <div className="workspace" ref={wsRef}>
            <div className="ws-main" style={{ flex: `${mainFrac} 1 0` }}>
              {renderHeader(active)}
              <TerminalView
                key={active.id}
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
                <div className="pane-label">🖥 terminal</div>
                {shellPane ? (
                  <TerminalView
                    key={shellPane.id}
                    session={shellPane}
                    onExit={() => markExited(shellPane.id)}
                    onTitle={() => {}}
                  />
                ) : (
                  <div className="placeholder">shell ended</div>
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
                <NotepadPane groupId={active.groupId} />
              </div>
            </div>
          </div>
        )}
      </main>

      <Splitter dir="x" onDrag={(d) => setWorkW((w) => clamp(w - d, 220, 560))} />

      {/* Right: work — live GitHub PRs + Linear tickets */}
      <div className="work-col" style={{ width: workW }}>
        <WorkPanel onOpenTicket={openTicket} onOpenPr={openPr} />
      </div>
      </div>

      {showNew && (
        <NewSessionDialog
          onClose={() => setShowNew(false)}
          onCreate={(cwd) => {
            setShowNew(false);
            addSession({ cwd });
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

      {errMsg && (
        <div className="toast" onClick={() => setErrMsg(null)}>
          <span>⚠️ {errMsg}</span>
          <button className="toast-x">×</button>
        </div>
      )}
    </div>
  );
}
