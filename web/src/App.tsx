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
import type { LinearIssue, LinearComment } from "../../server/linear.ts";
import type { SessionMeta } from "../../server/sessions.ts";

const COLORS = ["#ffb7d5", "#cdb4f6", "#b8e6d4", "#b4d8f6", "#ffd9b0", "#fff0a8"];

// Modifier symbol shown in the shortcuts hint (⌘ on macOS, Ctrl elsewhere).
const MOD =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
    ? "⌘"
    : "Ctrl";

function relTime(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Comments on a Linear ticket, shown in the read-only "look" view. Fetches
// lazily per ticket; stays quiet (renders nothing) on error or when empty.
function TicketComments({ ticketId }: { ticketId: string }) {
  const [comments, setComments] = useState<LinearComment[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setComments(null);
    setFailed(false);
    fetch(`/api/linear/comments?id=${encodeURIComponent(ticketId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.error) setFailed(true);
        else setComments((d.comments ?? []) as LinearComment[]);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [ticketId]);

  if (failed) return null;
  if (comments === null)
    return <div className="ticket-comments-note">loading comments…</div>;
  if (comments.length === 0)
    return <div className="ticket-comments-note">No comments yet.</div>;

  return (
    <div className="ticket-comments">
      <div className="ticket-comments-head">
        Comments <span className="pr-count">{comments.length}</span>
      </div>
      {comments.map((c, i) => (
        <div className="ticket-comment" key={i}>
          <div className="ticket-comment-meta">
            <strong>{c.author}</strong>
            <span className="ticket-comment-time">{relTime(c.at)}</span>
          </div>
          <div
            className="md"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(c.body) }}
          />
        </div>
      ))}
    </div>
  );
}

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
  // Inputs to the topbar fox: PRs needing me / total open PRs / unread Linear
  // notifications. The pose is derived from all three (see effect below).
  const [prNeedsMe, setPrNeedsMe] = useState(false);
  const [prCount, setPrCount] = useState(0);
  const [linearNotifs, setLinearNotifs] = useState(0);
  // groupId → the shell-tab id currently shown in that workspace's shell pane.
  const [shellTab, setShellTab] = useState<Record<string, string>>({});
  const [ticketModal, setTicketModal] = useState<{
    issue: LinearIssue;
    startAtWork: boolean;
  } | null>(null);
  const [prModal, setPrModal] = useState<PullRequest | null>(null);
  const [autoReviewPr, setAutoReviewPr] = useState<number | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  // Collapse the colour picker whenever we switch sessions.
  useEffect(() => setColorPickerOpen(false), [activeId]);
  const [runnRoot, setRunnRoot] = useState<string>("");
  const [denRoot, setDenRoot] = useState<string>("");

  useEffect(() => {
    fetch("/api/fs/roots")
      .then((r) => r.json())
      .then((d) => {
        setRunnRoot(d.runn ?? "");
        setDenRoot(d.den ?? "");
      })
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
        // The fox only reacts to PRs that need *my* action: my own PRs failing
        // CI or with changes requested, or reviews I owe. A PR I'm reviewing
        // failing its CI is the author's problem, so it doesn't count. (An
        // already-approved review-requested PR no longer counts either — the
        // server clears its needsAttention.)
        setPrNeedsMe(all.some((p) => p.needsAttention));
        setPrCount(all.length);
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
        if (!alive) return;
        if (d.issues) setIssues(d.issues as LinearIssue[]);
        // Unread Linear notifications nudge the fox to alert (see pose effect).
        if (typeof d.unreadNotifications === "number")
          setLinearNotifs(d.unreadNotifications);
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

  // Topbar fox pose, derived from every attention source: alert if a PR needs
  // me OR I have unread Linear notifications; else happy if any PRs are open;
  // else sit. (Linear notifications only nudge — click into the Linear app.)
  useEffect(() => {
    if (prNeedsMe || linearNotifs > 0) setStatusPose("alert");
    else if (prCount > 0) setStatusPose("happy");
    else setStatusPose("sit");
  }, [prNeedsMe, prCount, linearNotifs]);

  // Match a session's branch ticket hint to a PR / Linear ticket.
  const prByHint = (hint: string | null) =>
    hint ? prs.find((p) => p.ticketHint?.toLowerCase() === hint) : undefined;
  const issueByHint = (hint: string | null) =>
    hint ? issues.find((i) => i.ticketHint.toLowerCase() === hint) : undefined;

  const STATUS_TITLE: Record<FoxPose, string> = {
    happy: "all your PRs look happy 🎉",
    alert:
      "something needs you — a PR to fix, a review you owe, or Linear notifications",
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
  // A Claude workspace can hold several shell panes (tabs). Which tab is active
  // is tracked per group; falls back to the first shell when unset/closed.
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

  // Add another shell tab to the given workspace and switch to it. Refetches
  // the full list (the 4s poll only merges existing rows, never adds new ones).
  const addShellTab = async (anyIdInGroup: string, groupId: string) => {
    try {
      const meta = await api<SessionMeta>(
        `/api/sessions/${anyIdInGroup}/shell`,
        { method: "POST" },
      );
      const d = await api<{ sessions: SessionMeta[] }>("/api/sessions");
      setSessions(d.sessions);
      setShellTab((m) => ({ ...m, [groupId]: meta.id }));
    } catch (e) {
      setErrMsg((e as Error).message);
    }
  };

  // Close a single shell tab (leaves the rest of the workspace intact).
  const closeShellTab = async (shellId: string, groupId: string) => {
    try {
      await api(`/api/sessions/${shellId}?scope=one`, { method: "DELETE" });
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== shellId);
        // If the closed tab was active, fall back to another shell in the group.
        setShellTab((m) => {
          if (m[groupId] !== shellId) return m;
          const fallback = next.find(
            (s) => s.groupId === groupId && s.role === "shell",
          );
          return { ...m, [groupId]: fallback?.id ?? "" };
        });
        return next;
      });
    } catch (e) {
      setErrMsg((e as Error).message);
    }
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

  // --- Keyboard shortcuts ---
  // Cmd/Ctrl+N new claude · Cmd/Ctrl+T new shell · Cmd/Ctrl+1–9 switch to the
  // Nth rail session · Cmd/Ctrl+W close the active session. Handlers/state can
  // change between renders, so we read them through a ref and subscribe once.
  // (In the packaged app main.ts frees Cmd+W from the native menu; in the dev
  // browser Cmd+W still closes the tab — use the app for the full set.)
  const kb = useRef({
    rail,
    activeId,
    blocked: false,
    addSession,
    closeSession,
    selectSession,
  });
  kb.current = {
    rail,
    activeId,
    blocked:
      showNew || !!ticketModal || !!prModal || editingId !== null,
    addSession,
    closeSession,
    selectSession,
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const s = kb.current;
      if (s.blocked) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        setShowNew(true);
      } else if (k === "t") {
        e.preventDefault();
        s.addSession({ shell: true });
      } else if (k === "w") {
        if (!s.activeId) return;
        e.preventDefault();
        s.closeSession(s.activeId);
      } else if (k >= "1" && k <= "9") {
        const target = s.rail[Number(k) - 1];
        if (target) {
          e.preventDefault();
          s.selectSession(target.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  // --- Edit den itself (self-editing workspace) ---
  // A normal 3-pane Claude workspace rooted in den's own source, with a handover
  // seeded into the notepad. The sentinel ticket gives us race-safe reuse (one
  // editor at a time) + a locked, descriptive title.
  const DEN_TICKET = "den:self-edit";

  const denNotesSeed = (root: string) =>
    `# Editing den — handover\n\n` +
    `You're working on **den itself** — the source of the very app this session ` +
    `is running inside.\nRepo: \`${root}\`\n\n` +
    `## Orient\n` +
    `- Read \`CLAUDE.md\` first: architecture, features, conventions, gotchas.\n` +
    `- Dev loop: \`npm run dev\` (needs the Node ABI — \`npm run rebuild:node\`).\n` +
    `- **Do NOT repackage/reinstall the app** (\`npm run pack\`) unless andria ` +
    `explicitly asks.\n` +
    `- Verify with an isolated server + screenshots (see CLAUDE.md).\n\n` +
    `## Progress\n_(Claude keeps timestamped notes below as it works.)_\n`;

  const denPrompt =
    `You're now working on **den itself** — the source of the very app this ` +
    `session is running inside (this is its repo). First read ./CLAUDE.md to get ` +
    `oriented on the architecture, conventions, and gotchas, then tell me briefly ` +
    `that you're ready. Important: do NOT run \`npm run pack\` or reinstall/reopen ` +
    `the app unless I explicitly ask — I control when the running app is replaced. ` +
    `Then wait for me to tell you what to change.`;

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
      notepadSeed: denNotesSeed(denRoot),
      initialPrompt: denPrompt,
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
      <span className="color-picker">
        <button
          className="dot dot-btn"
          style={{ background: s.color }}
          title="recolour"
          onClick={() => setColorPickerOpen((o) => !o)}
        />
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
        {ticketId && <TicketComments ticketId={ticketId} />}
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
        {denRoot ? (
          <button
            className="brand-fox"
            onClick={openDenEditor}
            title="edit den — open a Claude session to change this app"
            aria-label="edit den"
          >
            <PixelFox size={30} />
          </button>
        ) : (
          <PixelFox size={30} />
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
            </ul>
          </div>
        </span>
        {active && (
          <span className="topbar-title" title={active.name}>
            <span className="dot" style={{ background: active.color }} />
            <span className="topbar-name">{active.name}</span>
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
                title={s.name}
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
            sessionId={active.id}
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
                    key={activeShell.id}
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
