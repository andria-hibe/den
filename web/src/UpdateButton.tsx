import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";
import { ConfirmCard, anchorBelow, type CardAnchor } from "./ConfirmCard.tsx";

interface UpdateStatus {
  available: boolean;
  commits: string[];
  dirty: boolean;
  state: "idle" | "building" | "staged" | "failed";
  log: string;
}

const SHOWN_COMMITS = 6;

/** The topbar's "update den": shown when den's checkout has commits this app
 * wasn't built from. Building and installing are separate clicks, and
 * installing quits den. */
export function UpdateButton({ onError }: { onError: (msg: string) => void }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [at, setAt] = useState<CardAnchor | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    api<UpdateStatus>("/api/den/update").then(setStatus, () => {});
  }, []);
  useEffect(() => {
    load();
    // Fast while a build runs, so "ready" shows soon after it lands.
    const t = setInterval(load, status?.state === "building" ? 5_000 : 60_000);
    return () => clearInterval(t);
  }, [load, status?.state]);

  if (!status?.available || (status.state === "idle" && !status.commits.length)) return null;

  const post = async (path: string) => {
    setSending(true);
    try {
      await api(path, { method: "POST" });
      load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const { state, commits, dirty } = status;
  const label = state === "building" ? "⬆ building…" : state === "staged" ? "⬆ install" : "⬆ update";
  const n = commits.length;
  const message =
    state === "staged" ? (
      <div>
        The new den is built. Installing quits den: every session ends and comes back exited, to restart from the
        rail. Nap first if you want their handovers saved.
      </div>
    ) : state === "building" ? (
      <div>Building den. This takes a few minutes; keep working, the button turns to install when it's ready.</div>
    ) : (
      <>
        <div>
          den's checkout has {n} change{n === 1 ? "" : "s"} this app wasn't built from:
        </div>
        <ul className="update-commits">
          {commits.slice(0, SHOWN_COMMITS).map((c) => (
            <li key={c}>{c}</li>
          ))}
          {n > SHOWN_COMMITS && <li>and {n - SHOWN_COMMITS} more</li>}
        </ul>
        {dirty && <div className="update-warn">Commit den's uncommitted changes first: a build would ship them.</div>}
        {state === "failed" && <pre className="update-log">{status.log || "The last build failed."}</pre>}
      </>
    );

  return (
    <>
      <button
        className={`btn topbar-day${state === "staged" ? " tucked" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => setAt(at ? null : anchorBelow(e.currentTarget))}
        title="Update den from its checkout"
      >
        {label}
      </button>
      {at && (
        <ConfirmCard
          at={at}
          message={message}
          confirmLabel={state === "staged" ? "quit and install" : "build"}
          busyLabel="…"
          busy={sending}
          confirmDisabled={state === "building" || (state !== "staged" && dirty)}
          onConfirm={() => void post(state === "staged" ? "/api/den/update/install" : "/api/den/update/build")}
          onCancel={() => setAt(null)}
        />
      )}
    </>
  );
}
