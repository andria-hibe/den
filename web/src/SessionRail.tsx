import type { ReactNode } from "react";
import type { SessionMeta } from "../../server/sessions.ts";

// The left column: one row per workspace (role === "main"), with rename-in-place,
// attention nudges, restart/close buttons, and the new-session actions below.
// Pure presentation — all state (sessions, rename draft) lives in App.
export function SessionRail({
  rail,
  activeId,
  width,
  editingId,
  draft,
  onDraftChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onSelect,
  onRestart,
  onClose,
  onNewClaude,
  onNewShell,
  renderLinks,
}: {
  rail: SessionMeta[];
  activeId: string | null;
  width: number;
  editingId: string | null;
  draft: string;
  onDraftChange: (draft: string) => void;
  onStartRename: (id: string, current: string) => void;
  onCommitRename: (id: string) => void;
  onCancelRename: () => void;
  onSelect: (id: string) => void;
  onRestart: (id: string) => void;
  onClose: (id: string) => void;
  onNewClaude: () => void;
  onNewShell: () => void;
  /** The ticket/PR chips for a row (App owns the issue/PR data they match). */
  renderLinks: (s: SessionMeta) => ReactNode;
}) {
  return (
    <aside className="panel rail" style={{ width }}>
      <h2>sessions</h2>
      <div className="session-list">
        {rail.map((s) => (
          <div
            key={s.id}
            className={`session ${s.id === activeId ? "active" : ""} ${s.attention ? "attn-row" : ""}`}
            onClick={() => onSelect(s.id)}
            tabIndex={0}
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
                onChange={(e) => onDraftChange(e.target.value)}
                onBlur={() => onCommitRename(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCommitRename(s.id);
                  if (e.key === "Escape") onCancelRename();
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="label"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onStartRename(s.id, s.name);
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
            {s.status === "exited" && (
              <button
                className="session-restart"
                title="restart session"
                onClick={(e) => {
                  e.stopPropagation();
                  onRestart(s.id);
                }}
              >
                ↻
              </button>
            )}
            <button
              className="session-close"
              title="close session"
              onClick={(e) => {
                e.stopPropagation();
                onClose(s.id);
              }}
            >
              ×
            </button>
            {renderLinks(s)}
          </div>
        ))}
        {rail.length === 0 && (
          <div className="placeholder">no sessions yet — start one below 🌱</div>
        )}
      </div>
      <div className="rail-actions">
        <button className="btn btn-primary" onClick={onNewClaude}>
          + claude
        </button>
        <button className="btn btn-ghost-outline" onClick={onNewShell}>
          + shell
        </button>
      </div>
    </aside>
  );
}
