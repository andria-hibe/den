import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { renderMarkdown } from "./markdown.ts";
import { isHandover } from "../../shared/handover.ts";

/** Is a scroll box at (or within `slack` px of) its bottom? The notepad follows
 * new entries only while this holds, so it never yanks someone who has
 * scrolled up to read an older entry. The slack absorbs sub-pixel rounding and
 * a trailing margin. Pure, for the test. */
export function isNearBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  slack = 24,
): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= slack;
}

// A workspace's handover notepad. Renders markdown in view mode; edit + save.
// A handover (shared/handover.ts) is rewritten in place at the top, so it
// opens at the top and den leaves the scroll alone. An older notepad that is
// still an appended log follows the newest entry instead: it scrolls to the
// bottom when the content changes, unless you have scrolled up, and picks
// following back up once you scroll to the bottom again.
export function NotepadPane({ groupId }: { groupId: string }) {
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = editing || dirty;
  const renderRef = useRef<HTMLDivElement>(null);
  // Following the bottom until the reader scrolls away from it.
  const followRef = useRef(true);

  const refresh = useCallback(async () => {
    if (busyRef.current) return; // don't clobber an in-progress edit
    try {
      const d = await api<{ content: string }>(`/api/notepad/${groupId}`);
      setContent((prev) => (prev === d.content ? prev : d.content ?? ""));
    } catch {
      // keep what we have
    }
  }, [groupId]);

  useEffect(() => {
    setEditing(false);
    setDirty(false);
    followRef.current = true; // a different workspace opens at its newest entry
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  // Before paint, so a new entry never flashes in at the old scroll position.
  useLayoutEffect(() => {
    const el = renderRef.current;
    if (el && followRef.current && !isHandover(content)) el.scrollTop = el.scrollHeight;
  }, [content, editing]);

  const onScroll = () => {
    const el = renderRef.current;
    if (el) followRef.current = isNearBottom(el.scrollTop, el.clientHeight, el.scrollHeight);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/notepad/${groupId}`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      });
      setDirty(false);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="notepad">
      <div className="notepad-head">
        <span className="notepad-title">📝 handover</span>
        {dirty && <span className="notepad-dirty">unsaved</span>}
        {editing ? (
          <button className="btn notepad-save" onClick={save} disabled={saving}>
            {saving ? "saving…" : "save"}
          </button>
        ) : (
          <button
            className="btn notepad-save"
            onClick={() => setEditing(true)}
            title="edit the handover"
          >
            edit
          </button>
        )}
      </div>
      {editing ? (
        <textarea
          className="notepad-body"
          value={content}
          spellCheck={false}
          autoFocus
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          placeholder="The main Claude keeps a handover here: where it stands, done, next, waiting on you…"
        />
      ) : content.trim() ? (
        <div
          ref={renderRef}
          onScroll={onScroll}
          className="notepad-render md"
          onDoubleClick={() => setEditing(true)}
          title="double-click to edit"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />
      ) : (
        <div
          className="notepad-render notepad-empty"
          onDoubleClick={() => setEditing(true)}
        >
          No handover yet.
        </div>
      )}
    </div>
  );
}
