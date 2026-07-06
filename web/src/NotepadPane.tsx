import { useCallback, useEffect, useRef, useState } from "react";

// Shows the workspace progress log (which the main Claude keeps). Auto-refreshes
// from the file unless you're editing; you can edit and Save it back.
export function NotepadPane({ groupId }: { groupId: string }) {
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const refresh = useCallback(async () => {
    // Don't clobber unsaved edits.
    if (dirtyRef.current) return;
    try {
      const res = await fetch(`/api/notepad/${groupId}`);
      const d = await res.json();
      setContent((prev) => (prev === d.content ? prev : d.content ?? ""));
    } catch {
      // keep what we have
    }
  }, [groupId]);

  useEffect(() => {
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
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="notepad">
      <div className="notepad-head">
        <span className="notepad-title">📝 progress</span>
        {dirty && <span className="notepad-dirty">unsaved</span>}
        <button
          className="btn notepad-save"
          onClick={save}
          disabled={!dirty || saving}
        >
          {saving ? "saving…" : "save"}
        </button>
      </div>
      <textarea
        className="notepad-body"
        value={content}
        spellCheck={false}
        onChange={(e) => {
          setContent(e.target.value);
          setDirty(true);
        }}
        placeholder="The main Claude keeps its progress log here as it works…"
      />
    </div>
  );
}
