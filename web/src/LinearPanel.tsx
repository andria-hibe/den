import { useState } from "react";
import type { LinearIssue } from "../../server/linear.ts";
import { api } from "./api.ts";
import { Fox } from "./Fox.tsx";
import { accentStyle, relTime } from "./format.ts";
import { usePersistentString } from "./usePersistent.ts";
import { useWorkData } from "./WorkData.tsx";

// The Linear section splits assigned tickets by their identifier prefix into
// FAST-* and CYCLE-* tabs (the two teams the maintainer works across). Anything
// that's neither falls under "other" so no ticket ever goes missing.
function issueGroup(identifier: string): "fast" | "cycle" | "other" {
  const prefix = identifier.split("-")[0]?.toUpperCase();
  if (prefix === "FAST") return "fast";
  if (prefix === "CYCLE") return "cycle";
  return "other";
}

const PRIORITY_CLASS: Record<number, string> = {
  1: "prio-urgent",
  2: "prio-high",
  3: "prio-medium",
  4: "prio-low",
};

function IssueCard({
  issue,
  onOpen,
  accent,
}: {
  issue: LinearIssue;
  onOpen: (issue: LinearIssue) => void;
  accent?: string;
}) {
  return (
    <div
      className={`pr-card ticket-card${accent ? " session-linked" : ""}`}
      style={accentStyle(accent)}
      onClick={() => onOpen(issue)}
      role="button"
      tabIndex={0}
    >
      <div className="pr-top">
        <span
          className="state-dot"
          style={{ background: issue.state.color }}
          title={issue.state.name}
        />
        <span className="pr-repo">{issue.identifier}</span>
        {issue.priority > 0 && (
          <span className={`pr-badge ${PRIORITY_CLASS[issue.priority]}`}>
            {issue.priorityLabel}
          </span>
        )}
        <a
          className="ticket-ext"
          href={issue.url}
          target="_blank"
          rel="noreferrer"
          title="open in Linear"
          onClick={(e) => e.stopPropagation()}
        >
          ↗
        </a>
        <span className="pr-time">{relTime(issue.updatedAt)}</span>
      </div>
      <div className="pr-title">{issue.title}</div>
      <div className="pr-meta">
        <span className="issue-state">{issue.state.name}</span>
        {issue.project && <span className="pr-badge">{issue.project}</span>}
      </div>
    </div>
  );
}

function ConnectForm({ onConnected }: { onConnected: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/linear/key", {
        method: "POST",
        body: JSON.stringify({ key: key.trim() }),
      });
      setKey("");
      onConnected();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="linear-connect">
      <div className="placeholder" style={{ padding: "2px 4px" }}>
        Paste a Linear personal API key (Read scope is enough).
      </div>
      <input
        className="path-input"
        type="password"
        placeholder="lin_api_…"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && connect()}
      />
      <button className="btn btn-primary" onClick={connect} disabled={busy}>
        {busy ? "connecting…" : "connect linear"}
      </button>
      {error && <div className="browser-error">⚠️ {error}</div>}
    </div>
  );
}

export function LinearSection({
  onOpenTicket,
  ticketColor,
}: {
  onOpenTicket: (issue: LinearIssue) => void;
  ticketColor?: (identifier: string, hint?: string) => string | undefined;
}) {
  const {
    linear: data,
    linearConnected: connected,
    linearError: error,
    linearLoading: loading,
    refreshIssues,
    disconnectLinear: disconnect,
  } = useWorkData();

  // Where to send you when you click the notifications nudge: your Linear
  // workspace inbox, derived from any issue URL (…/<workspace>/issue/…), else
  // the Linear app root.
  const inboxHref = (() => {
    const u = data?.issues[0]?.url;
    if (!u) return "https://linear.app";
    try {
      const parsed = new URL(u);
      const slug = parsed.pathname.split("/").filter(Boolean)[0];
      return slug ? `${parsed.origin}/${slug}/inbox` : parsed.origin;
    } catch {
      return "https://linear.app";
    }
  })();
  const notifs = data?.unreadNotifications ?? 0;

  const [tab, setTab] = usePersistentString("den.linearTab", "fast", [
    "fast",
    "cycle",
  ] as const);
  const issues = data?.issues ?? [];
  const fastIssues = issues.filter((i) => issueGroup(i.identifier) === "fast");
  const cycleIssues = issues.filter((i) => issueGroup(i.identifier) === "cycle");
  const otherIssues = issues.filter((i) => issueGroup(i.identifier) === "other");
  // Tickets that are neither FAST nor CYCLE ride along on whichever tab is
  // active so they never vanish.
  const shown = tab === "fast" ? [...fastIssues, ...otherIssues] : cycleIssues;

  return (
    <div className="pr-section">
      <div className="pr-section-title">
        <span>linear</span>
        {connected && data && <span className="pr-count">{data.issues.length}</span>}
        {connected && notifs > 0 && (
          <a
            className="linear-notif"
            href={inboxHref}
            target="_blank"
            rel="noreferrer"
            title={`${notifs} unread Linear notification${
              notifs === 1 ? "" : "s"
            } — open Linear to check`}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="linear-notif-bang">!</span>
            {notifs}
          </a>
        )}
        <span style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          {connected && (
            <>
              <button
                className="btn-ghost"
                onClick={refreshIssues}
                disabled={loading}
                title="refresh"
              >
                {loading ? "…" : "↻"}
              </button>
              <button className="btn-ghost" onClick={disconnect} title="disconnect">
                ⏻
              </button>
            </>
          )}
        </span>
      </div>

      {connected === null && (
        <div className="loading-row">
          <Fox pose="walk" size={20} /> checking…
        </div>
      )}
      {connected === false && <ConnectForm onConnected={refreshIssues} />}
      {connected && error && <div className="browser-error">⚠️ {error}</div>}
      {connected && data && (
        <>
          <div className="ticket-look-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "fast"}
              className={`look-tab${tab === "fast" ? " active" : ""}`}
              onClick={() => setTab("fast")}
            >
              FAST{fastIssues.length ? ` (${fastIssues.length})` : ""}
            </button>
            <button
              role="tab"
              aria-selected={tab === "cycle"}
              className={`look-tab${tab === "cycle" ? " active" : ""}`}
              onClick={() => setTab("cycle")}
            >
              CYCLE{cycleIssues.length ? ` (${cycleIssues.length})` : ""}
            </button>
          </div>
          {shown.length === 0 ? (
            <div className="placeholder" style={{ padding: "4px 6px" }}>
              no active tickets 🌿
            </div>
          ) : (
            shown.map((i) => (
              <IssueCard
                key={i.identifier}
                issue={i}
                onOpen={onOpenTicket}
                accent={ticketColor?.(i.identifier, i.ticketHint)}
              />
            ))
          )}
        </>
      )}
    </div>
  );
}
