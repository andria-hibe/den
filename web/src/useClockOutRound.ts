import { useCallback, useEffect, useRef, useState } from "react";
import type { ClockOutRound } from "../../server/sessions.ts";
import { api } from "./api.ts";
import { notify } from "./useNotifications.ts";

/** Hedgehog's clock out or nap round, polled while it runs. `unseen` stays true from
 * a round this window watched running until `ack()`, so its "all tucked in"
 * stays on screen until the developer has seen it. */
export function useClockOutRound() {
  const [round, setRound] = useState<ClockOutRound | null>(null);
  const [polling, setPolling] = useState(true);
  const [unseen, setUnseen] = useState(false);
  const sawRunning = useRef(false);

  useEffect(() => {
    if (!polling) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = (await api<{ round: ClockOutRound | null }>("/api/manager/clockout/round")).round;
        if (stopped) return;
        setRound(r);
        if (r && !r.finishedAt) {
          sawRunning.current = true;
          setUnseen(true);
        } else {
          if (r && sawRunning.current) {
            const left = r.panes.filter((p) => p.stage === "failed" || p.handoverFailed).length;
            if (r.kind === "nap") {
              if (left) notify("🦔 Nap round done", `${left} handover${left === 1 ? " wasn't" : "s weren't"} saved.`);
              else notify("🦔 Handovers saved", "Every session's handover is up to date. Enjoy the break.");
            } else if (left) notify("🦔 Clock out done", `${left} didn't finish cleanly. Check before closing your laptop.`);
            else notify("🦔 All tucked in", "Every handover is saved. Safe to close your laptop.");
          }
          sawRunning.current = false;
          setPolling(false);
          return;
        }
      } catch {
        // server restarting: keep trying
      }
      if (!stopped) timer = setTimeout(tick, 1000);
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [polling]);

  const watch = useCallback((r: ClockOutRound) => {
    sawRunning.current = true;
    setRound(r);
    setUnseen(true);
    setPolling(true);
  }, []);
  const ack = useCallback(() => setUnseen(false), []);

  return { round, unseen, watch, ack };
}
