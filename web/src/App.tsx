import { useRef, useState } from "react";
import { useTerminal, type TerminalConfig } from "./useTerminal.ts";
import { WorkPanel } from "./WorkPanel.tsx";

interface Session {
  id: string;
  name: string;
  color: string;
  cwd?: string;
  shell?: boolean;
  status: "running" | "ended";
}

// Pastel swatches assigned to new sessions in rotation.
const COLORS = ["#ffb7d5", "#cdb4f6", "#b8e6d4", "#b4d8f6", "#ffd9b0", "#fff0a8"];

let counter = 0;
function makeSession(partial?: Partial<Session>): Session {
  const id = `s${++counter}`;
  return {
    id,
    name: partial?.name ?? `den-${counter}`,
    color: partial?.color ?? COLORS[counter % COLORS.length],
    cwd: partial?.cwd,
    shell: partial?.shell,
    status: "running",
  };
}

function TerminalView({
  session,
  onExit,
}: {
  session: Session;
  onExit: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const config: TerminalConfig = {
    name: session.name,
    cwd: session.cwd,
    shell: session.shell,
  };
  useTerminal(hostRef, config, () => onExit(session.id));
  return <div className="term-host" ref={hostRef} />;
}

export function App() {
  const [sessions, setSessions] = useState<Session[]>(() => [
    makeSession({ name: "welcome", shell: false }),
  ]);
  const [activeId, setActiveId] = useState(sessions[0].id);
  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];

  const addSession = (shell = false) => {
    const s = makeSession({ shell, name: shell ? `shell-${counter + 1}` : undefined });
    setSessions((prev) => [...prev, s]);
    setActiveId(s.id);
  };

  const markEnded = (id: string) =>
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: "ended" } : s)),
    );

  return (
    <div className="app">
      <div className="topbar">
        🦊 <span>den</span>
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
            <span className="dot" style={{ background: s.color }} />
            <span className="label">{s.name}</span>
            <span className="status">
              {s.status === "running" ? "●" : "○"}
            </span>
          </div>
        ))}
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button className="btn" onClick={() => addSession(false)}>
            + claude
          </button>
          <button className="btn" onClick={() => addSession(true)}>
            + shell
          </button>
        </div>
      </aside>

      {/* Center: terminal */}
      <main className="panel term-wrap">
        <div className="term-header">
          <span className="dot" style={{ background: active.color }} />
          <strong>{active.name}</strong>
          <span style={{ marginLeft: "auto" }}>
            {active.shell ? "shell" : "claude"} · {active.status}
          </span>
        </div>
        {/* key forces a fresh terminal per session (scrollback-on-switch is v1) */}
        <TerminalView key={active.id} session={active} onExit={markEnded} />
      </main>

      {/* Right: work — live GitHub PRs */}
      <WorkPanel />
    </div>
  );
}
