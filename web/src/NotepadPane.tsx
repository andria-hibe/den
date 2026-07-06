import { useCallback, useEffect, useRef, useState } from "react";
import { renderMarkdown } from "./markdown.ts";

// Progress log for a workspace. Renders markdown in view mode; edit + save.
export function NotepadPane({ groupId }: { groupId: string }) {
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = editing || dirty;

  const refresh = useCallback(async () => {
    if (busyRef.current) return; // don't clobber an in-progress edit
    try {
      const res = await fetch(`/api/notepad/${groupId}`);
      const d = await res.json();
      setContent((prev) => (prev === d.content ? prev : d.content ?? ""));
    } catch {
      // keep what we have
    }
  }, [groupId]);

  useEffect(() => {
    setEditing(false);
    setDirty(false);
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/notepad/${groupId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
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
        <span className="notepad-title">📝 progress</span>
        {dirty && <span className="notepad-dirty">unsaved</span>}
        {editing ? (
          <button className="btn notepad-save" onClick={save} disabled={saving}>
            {saving ? "saving…" : "save"}
          </button>
        ) : (
          <button
            className="btn notepad-save"
            onClick={() => setEditing(true)}
            title="edit the log"
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
          placeholder="The main Claude keeps its progress log here as it works…"
        />
      ) : content.trim() ? (
        <div
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
          No progress logged yet.
        </div>
      )}
    </div>
  );
}
