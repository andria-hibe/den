import { useCallback, useEffect, useRef, useState } from "react";

// --- Minimal, safe markdown -> HTML (headings, lists, bold/italic/code, links).
// Content is escaped first, so the rendered HTML can't inject markup.
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(s: string) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
    );
}
function renderMarkdown(md: string): string {
  const lines = escapeHtml(md).split("\n");
  let html = "";
  let inCode = false;
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };
  for (const raw of lines) {
    if (raw.trim().startsWith("```")) {
      if (inCode) {
        html += "</pre>";
        inCode = false;
      } else {
        closeList();
        html += "<pre>";
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      html += raw + "\n";
      continue;
    }
    const heading = raw.match(/^(#{1,4})\s+(.*)$/);
    const bullet = raw.match(/^\s*[-*]\s+(.*)$/);
    if (heading) {
      closeList();
      const lvl = heading[1].length;
      html += `<h${lvl}>${inline(heading[2])}</h${lvl}>`;
    } else if (bullet) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${inline(bullet[1])}</li>`;
    } else if (raw.trim() === "") {
      closeList();
    } else {
      closeList();
      html += `<p>${inline(raw)}</p>`;
    }
  }
  if (inCode) html += "</pre>";
  closeList();
  return html;
}

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
          className="notepad-render"
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
