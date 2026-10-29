import { useEffect, useState } from "react";
import { api } from "./api.ts";

interface Status {
  available: boolean;
  denRunning: boolean;
  sessions: number;
}

/** Burrow's one-time offer to bring Den's sessions over. Shown while Den has
 * sessions Burrow doesn't; asks for Den to be quit first, since both apps
 * must never run the same session's terminal. */
export function DenImportBanner({ onImported }: { onImported: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      api<Status>("/api/import/den")
        .then((s) => !stop && setStatus(s))
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  if (!status?.available) return null;
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/import/den", { method: "POST" });
      setStatus({ ...status, available: false });
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const n = `${status.sessions} session${status.sessions === 1 ? "" : "s"}`;
  return (
    <div className="den-import">
      {status.denRunning ? (
        <span>Quit Den to bring its {n} over to Burrow.</span>
      ) : (
        <>
          <span>Bring Den&apos;s {n} over, with their handovers and settings?</span>
          <button className="btn btn-primary" disabled={busy} onClick={run}>
            {busy ? "bringing them over…" : "bring them over"}
          </button>
        </>
      )}
      {error && <span className="den-import-error">{error}</span>}
    </div>
  );
}
