import { useEffect, useRef, useState } from "react";
import { useTerminal } from "./useTerminal.ts";
import { WorkPanel } from "./WorkPanel.tsx";
import { NewSessionDialog } from "./NewSessionDialog.tsx";
import { PixelFox } from "./PixelFox.tsx";
import type { SessionMeta } from "../../server/sessions.ts";

const COLORS = ["#ffb7d5", "#cdb4f6", "#b8e6d4", "#b4d8f6", "#ffd9b0", "#fff0a8"];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  // Only set a JSON content-type when there's actually a body — Fastify rejects
  // an empty body when content-type is application/json (breaks DELETE).
  const headers = init?.body ? { "content-type": "application/json" } : undefined;
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function TerminalView({
  session,
  onExit,
}: {
  session: SessionMeta;
  onExit: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useTerminal(hostRef, session.id, onExit);
  return <div className="term-host" ref={hostRef} />;
}

export function App() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    api<{ sessions: SessionMeta[] }>("/api/sessions")
      .then((d) => {
        setSessions(d.sessions);
        const running = d.sessions.find((s) => s.status === "running");
        setActiveId((running ?? d.sessions[0])?.id ?? null);
      })
      .catch(() => {});
  }, []);

  const active = sessions.find((s) => s.id === activeId) ?? null;

  const addSession = async (opts: { shell?: boolean; cwd?: string }) => {
    const meta = await api<SessionMeta>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(opts),
    });
    setSessions((prev) => [...prev, meta]);
    setActiveId(meta.id);
  };

  const patch = async (id: string, body: { name?: string; color?: string }) => {
    const meta = await api<SessionMeta>(`/api/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    setSessions((prev) => prev.map((s) => (s.id === id ? meta : s)));
  };

  const closeSession = async (id: string) => {
    await api(`/api/sessions/${id}`, { method: "DELETE" });
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (activeId === id) setActiveId(next[next.length - 1]?.id ?? null);
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

  return (
    <div className="app">
      <div className="topbar">
        <PixelFox size={30} />
        <span>den</span>
        <span style={{ opacity: 0.85, fontWeight: 500, fontSize: 12 }}>
          your cozy Claude cockpit
        </span>
      </div>

      {/* Left: sessions */}
      <aside className="panel rail">
        <h2>sessions</h2>
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`session ${s.id === activeId ? "active" : ""}`}
            onClick={() => setActiveId(s.id)}
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
                title="double-click to rename"
              >
                {s.name}
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
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="placeholder">no sessions yet — spawn one below 🌱</div>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button className="btn" onClick={() => setShowNew(true)}>
            + claude
          </button>
          <button className="btn" onClick={() => addSession({ shell: true })}>
            + shell
          </button>
        </div>
      </aside>

      {/* Center: terminal */}
      <main className="panel term-wrap">
        {active ? (
          <>
            <div className="term-header">
              <span className="dot" style={{ background: active.color }} />
              <strong>{active.name}</strong>
              <span className="swatches">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className={`swatch ${c === active.color ? "on" : ""}`}
                    style={{ background: c }}
                    title="recolour"
                    onClick={() => patch(active.id, { color: c })}
                  />
                ))}
              </span>
              <span className="term-cwd" title={active.cwd}>
                {active.cwd.replace(/^\/Users\/[^/]+/, "~")}
              </span>
              <span style={{ marginLeft: "auto" }}>
                {active.shell ? "shell" : "claude"} · {active.status}
              </span>
            </div>
            <TerminalView
              key={active.id}
              session={active}
              onExit={() => markExited(active.id)}
            />
          </>
        ) : (
          <div className="empty-terminal">
            <PixelFox size={96} className="fox-bob" />
            <div className="placeholder">pick or spawn a session to begin</div>
          </div>
        )}
      </main>

      {/* Right: work — live GitHub PRs */}
      <WorkPanel />

      {showNew && (
        <NewSessionDialog
          onClose={() => setShowNew(false)}
          onCreate={(cwd) => {
            setShowNew(false);
            addSession({ cwd });
          }}
        />
      )}
    </div>
  );
}
