import { useEffect, useState } from "react";
import { api } from "./api.ts";

export interface AppRunner {
  name: string;
  kind: "runn" | "script" | null;
  running: boolean | null;
  url?: string;
  command?: string;
  /** Teardown command (runn's `runn down`); absent for a script app. */
  stopCommand?: string;
  /** runn: containers up; the stop button shows while any are. */
  containersUp?: number;
  /** den has a live tab running this app (a script app stops through it). */
  appTab?: boolean;
  dir: string;
}

/** A repo script as a person would say it: drops the usual "is the tool
 * installed" guard and "|| echo" fallback, so conductor.json's
 * `command -v runn >/dev/null 2>&1 && runn down || echo ...` reads as
 * `runn down`. Show the full command in a tooltip. */
export function shortCommand(cmd: string): string {
  return cmd
    .replace(/^command -v \S+ >\/dev\/null 2>&1 && /, "")
    .replace(/\s*\|\|\s*echo\b.*$/, "")
    .trim();
}

/** Is there something for the stop button to stop? */
export function canStop(r: AppRunner | null): boolean {
  if (!r?.kind) return false;
  if (r.kind === "runn") return !!r.stopCommand && (r.containersUp ?? 0) > 0;
  return !!r.appTab;
}

// Runs the workspace's app in a new shell tab, or links to it once den can
// tell it's up.
export function AppRunButton({
  sessionId,
  status,
  onLaunch,
  onStop,
}: {
  sessionId: string;
  /** Session status — re-poll when it flips (restart etc.). */
  status: string;
  onLaunch: (sessionId: string) => Promise<void>;
  /** Stop it (#28): the teardown in a new tab, or Ctrl-C in the app's tab. */
  onStop: (sessionId: string) => Promise<void>;
}) {
  const [runner, setRunner] = useState<AppRunner | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);

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

  const stop = canStop(runner) ? (
    <button
      className="btn btn-ghost-outline app-run-btn app-stop-btn"
      disabled={stopping}
      title={
        runner.stopCommand
          ? `stop ${runner.name}: runs ${shortCommand(runner.stopCommand)} in a new tab${runner.containersUp ? ` (${runner.containersUp} containers up)` : ""}`
          : `stop ${runner.name}: Ctrl-C in the tab den started it in`
      }
      onClick={async () => {
        setStopping(true);
        try {
          await onStop(sessionId);
        } finally {
          setStopping(false);
        }
      }}
    >
      {stopping ? "stopping…" : "■ stop"}
    </button>
  ) : null;

  if (runner.running && runner.url) {
    return (
      <>
      <a
        className="btn btn-ghost-outline app-run-btn running"
        href={runner.url}
        target="_blank"
        rel="noreferrer"
        title={`open ${runner.name} — running at ${runner.url}`}
      >
        ▶ open {runner.name}
      </a>
      {stop}
      </>
    );
  }

  return (
    <>
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
    {stop}
    </>
  );
}

interface WorktreeSetup {
  command: string | null;
  source: string | null;
  dir: string;
  main: boolean;
  missing: string[];
  then: string | null;
}

// Runs the repo's own worktree setup (#10) in a new shell tab. Only in an
// added worktree: the main checkout has nothing to copy in.
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
          : "Set this worktree up again. ") +
        `Runs ${setup.command} (from ${setup.source})` +
        (setup.then ? `, then ${setup.then} for its dependencies.` : ".")
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
