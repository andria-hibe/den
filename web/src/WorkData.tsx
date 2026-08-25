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
import { api } from "./api.ts";
import { prKey } from "./format.ts";
import { usePersistentJson } from "./usePersistent.ts";

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
  /** Silence a PR's "!" attention flag until the PR next changes (e.g. you're
   *  choosing not to review it). Clears the card badge, the topbar fox, and OS
   *  notifications together, since they all read the same shared data. */
  dismissPrAttention: (pr: PullRequest) => void;
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
      setPrs(await api<PrBuckets>(`/api/github/prs${refresh ? "?refresh=1" : ""}`));
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

  // Dismissed attention flags: prKey → the PR's `updatedAt` when you dismissed
  // it. The dismissal is scoped to that snapshot — if the PR later changes
  // (a new push / comment / review), the "!" comes back, mirroring how the OS
  // notifications only react to transitions.
  const [dismissed, setDismissed] = usePersistentJson<Record<string, string>>(
    "den.dismissedPrAttn",
    {},
  );

  const dismissPrAttention = useCallback(
    (pr: PullRequest) => {
      setDismissed((d) => ({ ...d, [prKey(pr)]: pr.updatedAt }));
    },
    [setDismissed],
  );

  // Apply the dismissals: any PR whose dismissed snapshot still matches its
  // current `updatedAt` has its needsAttention cleared. Every consumer (cards,
  // fox, notifications) reads these derived buckets, so they never disagree.
  const dprs = useMemo<PrBuckets | null>(() => {
    if (!prs) return null;
    const clear = (list: PullRequest[]) =>
      list.map((p) =>
        p.needsAttention && dismissed[prKey(p)] === p.updatedAt
          ? { ...p, needsAttention: false }
          : p,
      );
    return {
      ...prs,
      authored: clear(prs.authored),
      reviewRequested: clear(prs.reviewRequested),
    };
  }, [prs, dismissed]);

  // Prune stale dismissals so localStorage doesn't grow forever: drop any entry
  // whose PR has left the list (merged/closed) or moved on (updatedAt changed —
  // it re-alerts anyway, so the record is spent).
  useEffect(() => {
    if (!prs) return;
    const live = new Map(
      [...prs.authored, ...prs.reviewRequested].map((p) => [prKey(p), p.updatedAt]),
    );
    setDismissed((d) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(d)) {
        if (live.get(k) === v) next[k] = v;
        else changed = true;
      }
      return changed ? next : d;
    });
  }, [prs, setDismissed]);

  const flatPrs = useMemo(
    () => (dprs ? [...dprs.authored, ...dprs.reviewRequested] : []),
    [dprs],
  );

  // --- Linear issues ---
  const [linear, setLinear] = useState<LinearData | null>(null);
  const [linearConnected, setLinearConnected] = useState<boolean | null>(null);
  const [linearError, setLinearError] = useState<string | null>(null);
  const [linearLoading, setLinearLoading] = useState(false);

  // Raw fetch (not api()): a 409 means "no Linear key yet", which is a state,
  // not an error — it needs the status code, which api() folds into a throw.
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
    api<{ connected: boolean }>("/api/linear/status")
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
    await api("/api/linear/key", { method: "DELETE" });
    setLinear(null);
    setLinearConnected(false);
  }, []);

  const value = useMemo<WorkDataValue>(
    () => ({
      prs: dprs,
      flatPrs,
      prsError,
      prsLoading,
      refreshPrs: () => refreshPrs(true),
      dismissPrAttention,
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
      dprs,
      flatPrs,
      prsError,
      prsLoading,
      refreshPrs,
      dismissPrAttention,
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
