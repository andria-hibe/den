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

interface WorktreeSetup {
  command: string | null;
  source: string | null;
  dir: string;
  main: boolean;
  missing: string[];
}

// Workspace-header button that runs the repo's own worktree setup (#10), from
// its conductor.json or setup script, in a fresh shell tab. Only in an added
// worktree (the main checkout has nothing to copy in); highlighted when the
// worktree is missing files the main checkout has.
export function SetupButton({
  sessionId,
  status,
  onSetup,
}: {
  sessionId: string;
  status: string;
  onSetup: (sessionId: string) => Promise<void>;
}) {
  const [setup, setSetup] = useState<WorktreeSetup | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      api<WorktreeSetup>(`/api/app/setup?sessionId=${encodeURIComponent(sessionId)}`)
        .then((d) => alive && setSetup(d))
        .catch(() => {});
    poll();
    // Setup runs in a shell tab, so check again now and then to clear the flag.
    const t = setInterval(poll, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [sessionId, status]);

  if (!setup?.command || setup.main) return null;
  const needed = setup.missing.length > 0;
  return (
    <button
      className={`btn btn-ghost-outline app-run-btn${needed ? " needs-setup" : ""}`}
      disabled={busy}
      title={
        (needed
          ? `This worktree looks not set up: ${setup.missing.join(", ")} missing. `
          : "Set this worktree up again. ") + `Runs ${setup.command} (from ${setup.source}).`
      }
      onClick={async () => {
        setBusy(true);
        try {
          await onSetup(sessionId);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "starting…" : needed ? "⚙ set up" : "⚙"}
    </button>
  );
}
