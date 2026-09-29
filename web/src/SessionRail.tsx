import { useState, type ReactNode } from "react";
import type { SessionMeta } from "../../server/sessions.ts";
import { moveItem } from "./reorder.ts";

// The left column, one row per workspace. Pure presentation: all state lives in App.
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
  onCleanup,
  onReorder,
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
  /** Open (or return to) a Claude session that cleans up the work repo. */
  onCleanup: () => void;
  /** New rail order after a drag (or alt+arrow), as workspace ids top to bottom. */
  onReorder: (groupIds: string[]) => void;
  /** The ticket/PR chips for a row (App owns the issue/PR data they match). */
  renderLinks: (s: SessionMeta) => ReactNode;
}) {
  // Drag state is view-local: the index being dragged and the row it's over.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const commitMove = (from: number, to: number) => {
    const next = moveItem(rail, from, to);
    if (next !== rail) onReorder(next.map((s) => s.groupId));
  };

  const endDrag = () => {
    setDragFrom(null);
    setDragOver(null);
  };

  return (
    <aside className="panel rail" style={{ width }}>
      <h2>sessions</h2>
      <div className="session-list">
        {rail.map((s, i) => (
          <div
            key={s.id}
            className={`session ${s.id === activeId ? "active" : ""} ${s.attention ? "attn-row" : ""}${
              dragFrom === i ? " dragging" : ""
            }${
              dragOver === i && dragFrom !== null && dragFrom !== i
                ? // The dropped row takes this slot, so it lands *below* a row it
                  // came from above, and above one it came from below.
                  dragFrom < i
                  ? " drop-below"
                  : " drop-above"
                : ""
            }`}
            onClick={() => onSelect(s.id)}
            tabIndex={0}
            // Not draggable mid-rename, or the input can't be selected with the mouse.
            draggable={editingId !== s.id}
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = "move";
              // Firefox only starts a drag once some data is set.
              e.dataTransfer.setData("text/plain", s.id);
            }}
            onDragOver={(e) => {
              if (dragFrom === null) return;
              e.preventDefault(); // opts this row in as a drop target
              e.dataTransfer.dropEffect = "move";
              setDragOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) commitMove(dragFrom, i);
              endDrag();
            }}
            onDragEnd={endDrag}
            // Keyboard equivalent — plain arrows belong to the roving focus ring,
            // so reordering rides on alt+arrow.
            onKeyDown={(e) => {
              if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
              e.preventDefault();
              e.stopPropagation();
              commitMove(i, e.key === "ArrowUp" ? i - 1 : i + 1);
            }}
            title="drag to reorder (or alt+up/down)"
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
        <button
          className="btn btn-ghost-outline rail-cleanup"
          onClick={onCleanup}
          title="Clean up the work repo with Claude: merged worktrees, branches, and idle stacks. It shows a plan first and changes nothing until you approve."
          aria-label="clean up the work repo"
        >
          🧹
        </button>
      </div>
    </aside>
  );
}
