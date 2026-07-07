import { useCallback, useEffect, useState } from "react";
import type { LinearData, LinearIssue } from "../../server/linear.ts";
import { Fox } from "./Fox.tsx";

const PRIORITY_CLASS: Record<number, string> = {
  1: "prio-urgent",
  2: "prio-high",
  3: "prio-medium",
  4: "prio-low",
};

function relTime(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function IssueCard({
  issue,
  onOpen,
}: {
  issue: LinearIssue;
  onOpen: (issue: LinearIssue) => void;
}) {
  return (
    <div
      className="pr-card ticket-card"
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
      const res = await fetch("/api/linear/key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
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
}: {
  onOpenTicket: (issue: LinearIssue) => void;
}) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [data, setData] = useState<LinearData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadIssues = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/linear/issues${refresh ? "?refresh=1" : ""}`);
      if (res.status === 409) {
        setConnected(false);
        return;
      }
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setData(d);
      setConnected(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/linear/status")
      .then((r) => r.json())
      .then((s) => {
        setConnected(s.connected);
        if (s.connected) loadIssues();
      })
      .catch(() => setConnected(false));
  }, [loadIssues]);

  useEffect(() => {
    if (!connected) return;
    const t = setInterval(() => loadIssues(), 60_000);
    return () => clearInterval(t);
  }, [connected, loadIssues]);

  const disconnect = async () => {
    await fetch("/api/linear/key", { method: "DELETE" });
    setData(null);
    setConnected(false);
  };

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
                onClick={() => loadIssues(true)}
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
      {connected === false && <ConnectForm onConnected={() => loadIssues(true)} />}
      {connected && error && <div className="browser-error">⚠️ {error}</div>}
      {connected &&
        data &&
        (data.issues.length === 0 ? (
          <div className="placeholder" style={{ padding: "4px 6px" }}>
            no active tickets 🌿
          </div>
        ) : (
          data.issues.map((i) => (
            <IssueCard key={i.identifier} issue={i} onOpen={onOpenTicket} />
          ))
        ))}
    </div>
  );
}
