import { useEffect, useState } from "react";
import { api } from "./api.ts";
import type { SessionMeta } from "../../server/sessions.ts";

export interface AddSessionOpts {
  shell?: boolean;
  cwd?: string;
  resumeId?: string;
  ticket?: string;
  look?: boolean;
  branch?: string;
  env?: "local" | "worktree";
  name?: string;
  notepadSeed?: string;
  view?: "review" | "mypr";
  pr?: number;
  prRepo?: string;
  initialPrompt?: string;
}

/**
 * Owns the session list and everything that mutates it: create / rename /
 * recolour / restart / close, shell tabs, the active selection, and the 4s
 * poll that syncs names/status/attention from the server.
 *
 * The poll **only merges existing rows, never adds new ones** — so every
 * mutation that can create a session out-of-band (addSession, addShellTab,
 * launchApp) refetches the full list itself.
 */
export function useSessions({
  editingId,
  onError,
}: {
  /** Rail row being renamed — the poll and title events skip it so the input
   * isn't clobbered mid-edit. */
  editingId: string | null;
  onError: (msg: string) => void;
}) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // groupId → the shell-tab id currently shown in that workspace's shell pane.
  const [shellTab, setShellTab] = useState<Record<string, string>>({});

  useEffect(() => {
    api<{ sessions: SessionMeta[] }>("/api/sessions")
      .then((d) => {
        setSessions(d.sessions);
        const mains = d.sessions.filter((s) => s.role === "main");
        const running = mains.find((s) => s.status === "running");
        setActiveId((running ?? mains[0])?.id ?? null);
      })
      .catch(() => {});
  }, []);

  // Poll so auto-titles (and exits) on background sessions reach the rail.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const d = await api<{ sessions: SessionMeta[] }>("/api/sessions");
        setSessions((prev) =>
          prev.map((loc) => {
            const s = d.sessions.find((x) => x.id === loc.id);
            return s && editingId !== loc.id
              ? {
                  ...loc,
                  name: s.name,
                  status: s.status,
                  color: s.color,
                  attention: s.attention,
                }
              : loc;
          }),
        );
      } catch {
        // transient; try again next tick
      }
    }, 4000);
    return () => clearInterval(t);
  }, [editingId]);

  const addSession = async (opts: AddSessionOpts) => {
    try {
      const meta = await api<SessionMeta>("/api/sessions", {
        method: "POST",
        body: JSON.stringify(opts),
      });
      // Refetch so a Claude workspace's sibling shell pane lands in state too.
      const d = await api<{ sessions: SessionMeta[] }>("/api/sessions");
      setSessions(d.sessions);
      setActiveId(meta.id);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const patch = async (id: string, body: { name?: string; color?: string }) => {
    const meta = await api<SessionMeta>(`/api/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    // A recolour applies to the whole workspace server-side; mirror that.
    setSessions((prev) =>
      prev.map((s) =>
        s.id === meta.id
          ? meta
          : body.color !== undefined && s.groupId === meta.groupId
            ? { ...s, color: body.color }
            : s,
      ),
    );
  };

  // Re-spawn an exited session's PTY in place (keeps cwd/name/branch/ticket/PR).
  // The terminal is keyed by `id:status`, so flipping to running remounts it and
  // reconnects to the fresh process.
  const restartSession = async (id: string) => {
    try {
      const meta = await api<SessionMeta>(`/api/sessions/${id}/restart`, {
        method: "POST",
      });
      setSessions((prev) => prev.map((s) => (s.id === meta.id ? meta : s)));
      setActiveId(meta.id);
    } catch (e) {
      // 409 cannot_restart just means it's already running (e.g. a double-click);
      // that's benign, so don't nag with a toast.
      if ((e as Error).message !== "cannot_restart") onError((e as Error).message);
    }
  };

  const closeSession = async (id: string) => {
    const groupId = sessions.find((s) => s.id === id)?.groupId;
    await api(`/api/sessions/${id}`, { method: "DELETE" });
    setSessions((prev) => {
      const next = prev.filter((s) => s.groupId !== groupId);
      if (activeId === id) {
        setActiveId(next.find((s) => s.role === "main")?.id ?? null);
      }
      return next;
    });
  };

  // Add another shell tab to the given workspace and switch to it. Refetches
  // the full list (the 4s poll only merges existing rows, never adds new ones).
  const addShellTab = async (anyIdInGroup: string, groupId: string) => {
    try {
      const meta = await api<SessionMeta>(
        `/api/sessions/${anyIdInGroup}/shell`,
        { method: "POST" },
      );
      const d = await api<{ sessions: SessionMeta[] }>("/api/sessions");
      setSessions(d.sessions);
      setShellTab((m) => ({ ...m, [groupId]: meta.id }));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  // Spin up the workspace's app in a fresh shell tab (server adds the shell and
  // types the run command into it), then switch to that tab.
  const launchApp = async (sessionId: string) => {
    const group = sessions.find((s) => s.id === sessionId)?.groupId;
    try {
      const meta = await api<SessionMeta>("/api/app/run", {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      });
      const d = await api<{ sessions: SessionMeta[] }>("/api/sessions");
      setSessions(d.sessions);
      if (group) setShellTab((m) => ({ ...m, [group]: meta.id }));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  // Close a single shell tab (leaves the rest of the workspace intact).
  const closeShellTab = async (shellId: string, groupId: string) => {
    try {
      await api(`/api/sessions/${shellId}?scope=one`, { method: "DELETE" });
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== shellId);
        // If the closed tab was active, fall back to another shell in the group.
        setShellTab((m) => {
          if (m[groupId] !== shellId) return m;
          const fallback = next.find(
            (s) => s.groupId === groupId && s.role === "shell",
          );
          return { ...m, [groupId]: fallback?.id ?? "" };
        });
        return next;
      });
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const markExited = (id: string) =>
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: "exited" } : s)),
    );

  // Selecting a session views it — clear its attention nudge optimistically
  // (the server also clears it when the terminal re-attaches).
  const selectSession = (id: string) => {
    setActiveId(id);
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, attention: false } : s)),
    );
  };

  // Terminal-set title (Claude/shell) for a session — apply unless the user is
  // mid-rename of it.
  const applyTitle = (id: string, name: string) =>
    setSessions((prev) =>
      prev.map((s) => (s.id === id && editingId !== id ? { ...s, name } : s)),
    );

  return {
    sessions,
    activeId,
    shellTab,
    setShellTab,
    addSession,
    patch,
    restartSession,
    closeSession,
    addShellTab,
    launchApp,
    closeShellTab,
    markExited,
    selectSession,
    applyTitle,
  };
}
