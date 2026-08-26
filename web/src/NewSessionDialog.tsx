import { useEffect, useState, useCallback } from "react";
import { api } from "./api.ts";
import { PixelFox } from "./PixelFox.tsx";
import { relTimeAgo } from "./format.ts";
import { isValidBranch } from "../../shared/branch.ts";
import type { Worktree } from "../../server/git.ts";

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
/**
 * Work sessions live in a *workspace* — one checkout of the work repo: its own
 * working copy or a `git worktree`. Rather than always dropping into the repo
 * root, "Work" first asks which workspace to open in ("where"), then either
 * lists the ones that already exist ("existing") or takes a branch name for a
 * fresh worktree ("new"). `null` means we fell through to folder browsing.
 */
type WorkStep = "where" | "existing" | "new" | null;
interface PastSession {
  sessionId: string;
  cwd: string;
  title: string;
  updatedAt: number;
}

export function NewSessionDialog({
  onCreate,
  onCreateWorktree,
  onResume,
  onClose,
}: {
  onCreate: (cwd: string) => void;
  /** New workspace: the server creates the worktree for `branch`, then opens there. */
  onCreateWorktree: (branch: string) => void;
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
  const [workStep, setWorkStep] = useState<WorkStep>(null);
  // null while the worktree list is still loading.
  const [worktrees, setWorktrees] = useState<Worktree[] | null>(null);
  const [branch, setBranch] = useState("");

  useEffect(() => {
    api<Roots>("/api/fs/roots")
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
      try {
        const d = await api<Listing>(
          `/api/fs/dirs?path=${encodeURIComponent(expanded)}`,
        );
        setListing(d);
        setPath(d.path);
      } catch (e) {
        setError(`can't open ${short(expanded)} (${(e as Error).message})`);
      }
    },
    [roots, short],
  );

  const choose = (m: Mode) => {
    setMode(m);
    setWorkStep(null);
    if (m === "resume") {
      setPast(null);
      api<{ sessions: PastSession[] }>("/api/sessions/past")
        .then((d) => setPast(d.sessions ?? []))
        .catch(() => setPast([]));
      return;
    }
    if (!roots) return;
    if (m === "work") {
      // Ask which workspace first. Load the checkouts in the background; if the
      // work dir isn't a git repo (workDir() can fall back to ~/Documents/work)
      // there are no workspaces to offer, so drop straight to folder browsing.
      setWorkStep("where");
      setWorktrees(null);
      setBranch("");
      api<{ worktrees: Worktree[] }>("/api/git/worktrees")
        .then((d) => setWorktrees(d.worktrees.filter((w) => !w.bare)))
        .catch(() => {
          setWorkStep(null);
          navigate(roots.workRepo);
        });
      return;
    }
    const start = m === "personal" ? roots.projects : roots.documents;
    navigate(start);
  };

  // Back to the four top-level cards.
  const backToModes = () => {
    setMode(null);
    setWorkStep(null);
  };

  // Leave the workspace flow and browse folders under the work repo instead.
  const browseWorkRepo = () => {
    setWorkStep(null);
    if (roots) navigate(roots.workRepo);
  };

  const branchOk = isValidBranch(branch.trim());


  const createFolder = async () => {
    if (!newName.trim()) return;
    try {
      const d = await api<{ path: string }>("/api/fs/dirs", {
        method: "POST",
        body: JSON.stringify({ parent: path, name: newName }),
      });
      setNewName("");
      navigate(d.path); // step into the folder we just made
    } catch (e) {
      setError((e as Error).message);
    }
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
              <button className="btn-ghost" onClick={backToModes} title="back">
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
                    {short(p.cwd)} · {relTimeAgo(p.updatedAt)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : mode === "work" && workStep === "where" ? (
          <div className="browser">
            <div className="browser-bar">
              <button className="btn-ghost" onClick={backToModes} title="back">
                ‹
              </button>
              <span className="path-input" style={{ display: "flex", alignItems: "center" }}>
                {short(roots?.workRepo ?? "")} — which workspace?
              </span>
            </div>
            <div className="choose-grid">
              <button
                className="choose-card work"
                onClick={() => setWorkStep("existing")}
                disabled={!worktrees?.length}
              >
                <div className="choose-emoji">🌿</div>
                <div className="choose-text">
                  <div className="choose-title">Existing workspace</div>
                  <div className="choose-sub">
                    {worktrees === null
                      ? "looking…"
                      : worktrees.length === 1
                        ? "just the repo itself so far"
                        : `${worktrees.length} checkouts to pick from`}
                  </div>
                </div>
              </button>
              <button className="choose-card other" onClick={() => setWorkStep("new")}>
                <div className="choose-emoji">✨</div>
                <div className="choose-text">
                  <div className="choose-title">New workspace</div>
                  <div className="choose-sub">a fresh git worktree on its own branch</div>
                </div>
              </button>
            </div>
            <button
              className="btn btn-ghost-outline"
              style={{ marginTop: 10 }}
              onClick={browseWorkRepo}
            >
              📁 browse folders instead
            </button>
          </div>
        ) : mode === "work" && workStep === "existing" ? (
          <div className="browser">
            <div className="browser-bar">
              <button
                className="btn-ghost"
                onClick={() => setWorkStep("where")}
                title="back"
              >
                ‹
              </button>
              <span className="path-input" style={{ display: "flex", alignItems: "center" }}>
                open in an existing workspace
              </span>
            </div>
            <div className="browser-list">
              {worktrees?.map((w) => (
                <button
                  key={w.path}
                  className="resume-row"
                  onClick={() => onCreate(w.path)}
                  title={w.path}
                >
                  <div className="wt-row-head">
                    <div className="resume-title">
                      🌿 {w.branch ?? `detached @ ${w.head}`}
                    </div>
                    {w.main && <span className="dir-tag">★ main checkout</span>}
                    {w.locked && <span className="dir-tag">locked</span>}
                  </div>
                  <div className="resume-meta">{short(w.path)}</div>
                </button>
              ))}
            </div>
          </div>
        ) : mode === "work" && workStep === "new" ? (
          <div className="browser">
            <div className="browser-bar">
              <button
                className="btn-ghost"
                onClick={() => setWorkStep("where")}
                title="back"
              >
                ‹
              </button>
              <span className="path-input" style={{ display: "flex", alignItems: "center" }}>
                new workspace
              </span>
            </div>
            <div className="ticket-branch">
              worktree:{" "}
              <code>
                {short(
                  `${roots?.workRepo ?? ""}/.claude-worktrees/${
                    // prepareWork flattens slashes into the directory name.
                    branch.trim().replace(/[/\\]/g, "-") || "…"
                  }`,
                )}
              </code>
            </div>
            <div className="new-folder">
              <input
                placeholder="branch name, e.g. andria/fast-1234-thing"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && branchOk && onCreateWorktree(branch.trim())
                }
                spellCheck={false}
              />
              <button
                className="btn btn-primary"
                disabled={!branchOk}
                onClick={() => onCreateWorktree(branch.trim())}
              >
                🌿 create &amp; open
              </button>
            </div>
            {branch.trim() !== "" && !branchOk && (
              <div className="browser-error">
                ⚠️ letters, numbers and . _ / - only, and no leading dash
              </div>
            )}
            <div className="modal-foot">
              <span className="foot-path">
                off a fresh origin/master; an existing branch is reused
              </span>
            </div>
          </div>
        ) : (
          <div className="browser">
            <div className="browser-bar">
              <button className="btn-ghost" onClick={backToModes} title="back">
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
