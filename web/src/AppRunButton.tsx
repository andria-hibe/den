import { useEffect, useState } from "react";
import { api } from "./api.ts";

interface AppRunner {
  name: string;
  kind: "runn" | "script" | null;
  running: boolean | null;
  url?: string;
  command?: string;
  dir: string;
}

// Workspace-header button that runs the app this workspace is working on.
// If we can tell it's already up (runn), it becomes an "open" link; otherwise
// it's a "run" button that spins the app up in a fresh shell tab. Hidden when
// the workspace has no locally-runnable app.
export function AppRunButton({
  sessionId,
  status,
  onLaunch,
}: {
  sessionId: string;
  /** Session status — re-poll when it flips (restart etc.). */
  status: string;
  onLaunch: (sessionId: string) => Promise<void>;
}) {
  const [runner, setRunner] = useState<AppRunner | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await api<AppRunner>(
          `/api/app/runner?sessionId=${encodeURIComponent(sessionId)}`,
        );
        if (alive) setRunner(r);
      } catch {
        // transient — keep the last known state
      }
    };
    poll();
    const t = setInterval(poll, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [sessionId, status]);

  if (!runner?.kind || !runner.command) return null;

  if (runner.running && runner.url) {
    return (
      <a
        className="btn btn-ghost-outline app-run-btn running"
        href={runner.url}
        target="_blank"
        rel="noreferrer"
        title={`open ${runner.name} — running at ${runner.url}`}
      >
        ▶ open {runner.name}
      </a>
    );
  }

  return (
    <button
      className="btn btn-ghost-outline app-run-btn"
      disabled={busy}
      title={`run ${runner.name} locally — ${runner.command}`}
      onClick={async () => {
        setBusy(true);
        try {
          await onLaunch(sessionId);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "starting…" : `▶ run ${runner.name}`}
    </button>
  );
}
