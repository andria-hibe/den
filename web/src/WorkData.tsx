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

// The one poll of GitHub PRs and Linear issues, shared so the topbar fox and
// the panels never drift out of phase.
const POLL_MS = 60_000;

interface WorkDataValue {
  // GitHub
  prs: PrBuckets | null;
  flatPrs: PullRequest[];
  prsError: string | null;
  prsLoading: boolean;
  refreshPrs: () => void;
  /** Silence a PR's "!" attention flag until the PR next changes. */
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

  // prKey → the PR's `updatedAt` when dismissed. Once the PR changes (a push,
  // comment, or review), the "!" comes back.
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

  // Every consumer (cards, fox, notifications) reads these derived buckets, so
  // they never disagree about a dismissal.
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

  // Prune dismissals whose PR has left the list or changed since, so
  // localStorage doesn't grow forever.
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

  // Raw fetch, not api(): a 409 means "no Linear key yet", a state rather than
  // an error, and api() folds the status code into a throw.
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

  useEffect(() => {
    api<{ connected: boolean }>("/api/linear/status")
      .then((s) => {
        setLinearConnected(s.connected);
        if (s.connected) refreshIssues();
      })
      .catch(() => setLinearConnected(false));
  }, [refreshIssues]);

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
