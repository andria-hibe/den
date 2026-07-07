import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PrBuckets, PullRequest } from "../../server/github.ts";
import type { LinearData, LinearIssue } from "../../server/linear.ts";

// Single source of truth for GitHub PRs + Linear issues. Previously App, the
// WorkPanel, and the LinearSection each ran their own 60s poll of the same two
// endpoints, so the topbar fox and the panels could drift out of phase (e.g. a
// manual refresh in a panel left the fox stale). This provider polls each
// resource once and shares the result, so everything reads the same data.
const POLL_MS = 60_000;

interface WorkDataValue {
  // GitHub
  prs: PrBuckets | null;
  flatPrs: PullRequest[];
  prsError: string | null;
  prsLoading: boolean;
  refreshPrs: () => void;
  // Linear
  linear: LinearData | null;
  issues: LinearIssue[];
  linearNotifs: number;
  linearConnected: boolean | null;
  linearError: string | null;
  linearLoading: boolean;
  refreshIssues: () => void;
  disconnectLinear: () => Promise<void>;
}

const WorkDataContext = createContext<WorkDataValue | null>(null);

export function WorkDataProvider({ children }: { children: ReactNode }) {
  // --- GitHub PRs ---
  const [prs, setPrs] = useState<PrBuckets | null>(null);
  const [prsError, setPrsError] = useState<string | null>(null);
  const [prsLoading, setPrsLoading] = useState(false);

  const refreshPrs = useCallback(async (refresh = false) => {
    setPrsLoading(true);
    setPrsError(null);
    try {
      const res = await fetch(`/api/github/prs${refresh ? "?refresh=1" : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PrBuckets & { error?: string };
      if (json.error) throw new Error(json.error);
      setPrs(json);
    } catch (e) {
      setPrsError((e as Error).message);
    } finally {
      setPrsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshPrs();
    const t = setInterval(() => refreshPrs(), POLL_MS);
    return () => clearInterval(t);
  }, [refreshPrs]);

  const flatPrs = useMemo(
    () => (prs ? [...prs.authored, ...prs.reviewRequested] : []),
    [prs],
  );

  // --- Linear issues ---
  const [linear, setLinear] = useState<LinearData | null>(null);
  const [linearConnected, setLinearConnected] = useState<boolean | null>(null);
  const [linearError, setLinearError] = useState<string | null>(null);
  const [linearLoading, setLinearLoading] = useState(false);

  const refreshIssues = useCallback(async (refresh = false) => {
    setLinearLoading(true);
    setLinearError(null);
    try {
      const res = await fetch(`/api/linear/issues${refresh ? "?refresh=1" : ""}`);
      if (res.status === 409) {
        setLinearConnected(false);
        return;
      }
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setLinear(d as LinearData);
      setLinearConnected(true);
    } catch (e) {
      setLinearError((e as Error).message);
    } finally {
      setLinearLoading(false);
    }
  }, []);

  // Initial connection check, then load if connected.
  useEffect(() => {
    fetch("/api/linear/status")
      .then((r) => r.json())
      .then((s) => {
        setLinearConnected(s.connected);
        if (s.connected) refreshIssues();
      })
      .catch(() => setLinearConnected(false));
  }, [refreshIssues]);

  // Poll only while connected.
  useEffect(() => {
    if (!linearConnected) return;
    const t = setInterval(() => refreshIssues(), POLL_MS);
    return () => clearInterval(t);
  }, [linearConnected, refreshIssues]);

  const disconnectLinear = useCallback(async () => {
    await fetch("/api/linear/key", { method: "DELETE" });
    setLinear(null);
    setLinearConnected(false);
  }, []);

  const value = useMemo<WorkDataValue>(
    () => ({
      prs,
      flatPrs,
      prsError,
      prsLoading,
      refreshPrs: () => refreshPrs(true),
      linear,
      issues: linear?.issues ?? [],
      linearNotifs: linear?.unreadNotifications ?? 0,
      linearConnected,
      linearError,
      linearLoading,
      refreshIssues: () => refreshIssues(true),
      disconnectLinear,
    }),
    [
      prs,
      flatPrs,
      prsError,
      prsLoading,
      refreshPrs,
      linear,
      linearConnected,
      linearError,
      linearLoading,
      refreshIssues,
      disconnectLinear,
    ],
  );

  return (
    <WorkDataContext.Provider value={value}>
      {children}
    </WorkDataContext.Provider>
  );
}

export function useWorkData(): WorkDataValue {
  const ctx = useContext(WorkDataContext);
  if (!ctx) throw new Error("useWorkData must be used within WorkDataProvider");
  return ctx;
}
