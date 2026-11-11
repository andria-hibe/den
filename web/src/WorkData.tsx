import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  /** prKey -> when its snooze ends (epoch ms). Snoozed PRs are left out of
   * `prs` and `flatPrs`, so no card, "!", or notification shows them. */
  snoozed: Record<string, number>;
  /** Hide a PR until `until`, or wake it with null. */
  snoozePr: (key: string, until: number | null) => void;
  /** The PRs `prs` leaves out because they're snoozed. */
  snoozedPrs: { authored: PullRequest[]; reviewRequested: PullRequest[] };
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

  // Kept by the server, so Fox's digest can list them under Later.
  const [snoozedRaw, setSnoozed] = useState<Record<string, number>>({});
  // Bumped by every snooze, so an answer to an older request can't undo it.
  const snoozeSeq = useRef(0);
  const takeSnoozes = useCallback((seq: number, next: Record<string, number>) => {
    if (seq !== snoozeSeq.current) return;
    setSnoozed((m) => (JSON.stringify(m) === JSON.stringify(next) ? m : next));
  }, []);
  const loadSnoozes = useCallback(() => {
    const seq = snoozeSeq.current;
    api<{ snoozed: Record<string, number> }>("/api/github/snoozes")
      .then((d) => takeSnoozes(seq, d.snoozed))
      .catch(() => {});
  }, [takeSnoozes]);
  useEffect(() => {
    loadSnoozes();
    const t = setInterval(loadSnoozes, POLL_MS);
    return () => clearInterval(t);
  }, [loadSnoozes]);
  const snoozePr = useCallback((key: string, until: number | null) => {
    const seq = ++snoozeSeq.current;
    setSnoozed((m) => {
      const next = { ...m };
      if (until === null) delete next[key];
      else next[key] = until;
      return next;
    });
    api<{ snoozed: Record<string, number> }>("/api/github/snooze", {
      method: "POST",
      body: JSON.stringify({ key, until }),
    })
      .then((d) => takeSnoozes(seq, d.snoozed))
      .catch(() => seq === snoozeSeq.current && loadSnoozes());
  }, [loadSnoozes, takeSnoozes]);
  // Ended snoozes drop out on the next poll, which re-runs this.
  const snoozed = useMemo(() => {
    const now = Date.now();
    return Object.fromEntries(Object.entries(snoozedRaw).filter(([, until]) => until > now));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prs is the clock: a fresh poll re-checks the times
  }, [snoozedRaw, prs]);

  // Every consumer (cards, fox, notifications) reads these derived buckets, so
  // they never disagree about a dismissal or a snooze.
  const { dprs, snoozedPrs } = useMemo(() => {
    const empty = { authored: [] as PullRequest[], reviewRequested: [] as PullRequest[] };
    if (!prs) return { dprs: null, snoozedPrs: empty };
    const clear = (list: PullRequest[]) =>
      list
        .filter((p) => !snoozed[prKey(p)])
        .map((p) =>
          p.needsAttention && dismissed[prKey(p)] === p.updatedAt
            ? { ...p, needsAttention: false }
            : p,
        );
    const asleep = (list: PullRequest[]) => list.filter((p) => snoozed[prKey(p)]);
    return {
      dprs: { ...prs, authored: clear(prs.authored), reviewRequested: clear(prs.reviewRequested) } as PrBuckets,
      snoozedPrs: { authored: asleep(prs.authored), reviewRequested: asleep(prs.reviewRequested) },
    };
  }, [prs, dismissed, snoozed]);

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
      snoozed,
      snoozePr,
      snoozedPrs,
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
      snoozed,
      snoozePr,
      snoozedPrs,
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
