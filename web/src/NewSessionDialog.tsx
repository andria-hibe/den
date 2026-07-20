import { useEffect, useState, useCallback } from "react";
import { PixelFox } from "./PixelFox.tsx";

interface Roots {
  home: string;
  documents: string;
  work: string;
  workRepo: string;
  projects: string;
}
interface Listing {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
}
type Mode = "work" | "personal" | "other" | "resume";
interface PastSession {
  sessionId: string;
  cwd: string;
  title: string;
  updatedAt: number;
}

export function NewSessionDialog({
  onCreate,
  onResume,
  onClose,
}: {
  onCreate: (cwd: string) => void;
  onResume: (cwd: string, resumeId: string) => void;
  onClose: () => void;
}) {
  const [roots, setRoots] = useState<Roots | null>(null);
  const [past, setPast] = useState<PastSession[] | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [path, setPath] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/fs/roots")
      .then((r) => r.json())
      .then(setRoots)
      .catch(() => setError("could not load folders"));
  }, []);

  const short = useCallback(
    (p: string) => (roots && p.startsWith(roots.home) ? "~" + p.slice(roots.home.length) : p),
    [roots],
  );

  const navigate = useCallback(
    async (p: string) => {
      setError(null);
      const expanded = roots && p.startsWith("~") ? roots.home + p.slice(1) : p;
      const res = await fetch(`/api/fs/dirs?path=${encodeURIComponent(expanded)}`);
      const d = await res.json();
      if (d.error) {
        setError(`can't open ${short(expanded)} (${d.error})`);
        return;
      }
      setListing(d);
      setPath(d.path);
    },
    [roots, short],
  );

  const choose = (m: Mode) => {
    setMode(m);
    if (m === "resume") {
      setPast(null);
      fetch("/api/sessions/past")
        .then((r) => r.json())
        .then((d) => setPast(d.sessions ?? []))
        .catch(() => setPast([]));
      return;
    }
    if (!roots) return;
    const start =
      m === "work" ? roots.workRepo : m === "personal" ? roots.projects : roots.documents;
    navigate(start);
  };

  const relTime = (ms: number) => {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  };
  const shortPath = (p: string) =>
    roots && p.startsWith(roots.home) ? "~" + p.slice(roots.home.length) : p;

  const createFolder = async () => {
    if (!newName.trim()) return;
    const res = await fetch("/api/fs/dirs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parent: path, name: newName }),
    });
    const d = await res.json();
    if (d.error) {
      setError(d.error);
      return;
    }
    setNewName("");
    navigate(d.path); // step into the folder we just made
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <PixelFox size={30} /> new claude session
          </strong>
          <button className="btn-ghost" onClick={onClose} title="cancel">
            ×
          </button>
        </div>

        {!mode ? (
          <div className="choose-grid">
            <button className="choose-card work" onClick={() => choose("work")}>
              <div className="choose-emoji">🏢</div>
              <div className="choose-text">
                <div className="choose-title">Work</div>
                <div className="choose-sub">your main repo &amp; work folder</div>
              </div>
            </button>
            <button
              className="choose-card personal"
              onClick={() => choose("personal")}
            >
              <div className="choose-emoji">🌸</div>
              <div className="choose-text">
                <div className="choose-title">Personal</div>
                <div className="choose-sub">projects — pick or create a folder</div>
              </div>
            </button>
            <button className="choose-card other" onClick={() => choose("other")}>
              <div className="choose-emoji">✨</div>
              <div className="choose-text">
                <div className="choose-title">Other</div>
                <div className="choose-sub">type a path or start in Documents</div>
              </div>
            </button>
            <button className="choose-card resume" onClick={() => choose("resume")}>
              <div className="choose-emoji">⏳</div>
              <div className="choose-text">
                <div className="choose-title">Resume</div>
                <div className="choose-sub">pick up a past Claude session</div>
              </div>
            </button>
          </div>
        ) : mode === "resume" ? (
          <div className="browser">
            <div className="browser-bar">
              <button className="btn-ghost" onClick={() => setMode(null)} title="back">
                ‹
              </button>
              <span className="path-input" style={{ display: "flex", alignItems: "center" }}>
                resume a past session
              </span>
            </div>
            <div className="browser-list">
              {past === null && <div className="placeholder" style={{ padding: 8 }}>loading…</div>}
              {past?.length === 0 && (
                <div className="placeholder" style={{ padding: 8 }}>
                  no past sessions found
                </div>
              )}
              {past?.map((p) => (
                <button
                  key={p.sessionId}
                  className="resume-row"
                  onClick={() => onResume(p.cwd, p.sessionId)}
                  title={p.cwd}
                >
                  <div className="resume-title">{p.title}</div>
                  <div className="resume-meta">
                    {shortPath(p.cwd)} · {relTime(p.updatedAt)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="browser">
            <div className="browser-bar">
              <button className="btn-ghost" onClick={() => setMode(null)} title="back">
                ‹
              </button>
              <button
                className="btn-ghost"
                disabled={!listing?.parent}
                onClick={() => listing?.parent && navigate(listing.parent)}
                title="up one folder"
              >
                ↑
              </button>
              <input
                className="path-input"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && navigate(path)}
                spellCheck={false}
              />
            </div>

            {error && <div className="browser-error">⚠️ {error}</div>}

            <div className="browser-list">
              {listing?.dirs.length === 0 && (
                <div className="placeholder" style={{ padding: 8 }}>
                  no sub-folders here
                </div>
              )}
              {listing?.dirs.map((d) => (
                <button
                  key={d.path}
                  className={`dir-row ${roots && d.path === roots.workRepo ? "highlight" : ""}`}
                  onClick={() => navigate(d.path)}
                  onDoubleClick={() => onCreate(d.path)}
                  title="click to open, double-click to start here"
                >
                  📁 {d.name}
                  {roots && d.path === roots.workRepo && (
                    <span className="dir-tag">★ default</span>
                  )}
                </button>
              ))}
            </div>

            <div className="new-folder">
              <input
                placeholder="new folder name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createFolder()}
              />
              <button className="btn" onClick={createFolder} disabled={!newName.trim()}>
                ＋ create
              </button>
            </div>

            <div className="modal-foot">
              <span className="foot-path">start in {short(path)}</span>
              <button className="btn btn-primary" onClick={() => onCreate(path)}>
                open claude here →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
