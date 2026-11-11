import { useState } from "react";
import { usePersistentJson } from "./usePersistent.ts";
import { api } from "./api.ts";
import type { PullRequest } from "../../server/github.ts";
import type { SavedPrompt } from "../../server/reviewPrompts.ts";
import type { ReviewFocus } from "./prompts.ts";
import { PromptEditor, useSavedPrompts } from "./ReviewPrompts.tsx";

/** What Claude does first when a review opens: the review (reading guide,
 * then the finding pass, with its focus), the cheap reading guide only for a
 * PR small enough to read yourself, or nothing until you ask. */
/** The pick from before saved prompts, stored as a bare string. */
function lastPreReview(): string {
  try {
    return localStorage.getItem("den.preReview") ?? "full";
  } catch {
    return "full";
  }
}

export interface ReviewStart {
  start: "review" | "guide" | "none";
  focus: ReviewFocus;
  owned: boolean;
}

const BUILT_IN = [
  ["full", "Full pre-review", "reading guide, then the code-review pass"],
  ["blockers", "Blockers only", "the same, but only what should stop the merge, performance included"],
] as const;
const AFTER = [
  ["guide", "Reading guide only", "cheaper, for a PR small enough to read yourself"],
  ["none", "Nothing yet", "ask from the Guide or Review tab when you want"],
] as const;

export function PrDialog({
  pr,
  onReview,
  onEditMine,
  onClose,
}: {
  pr: PullRequest;
  onReview: (pr: PullRequest, opts: ReviewStart) => void;
  onEditMine: (pr: PullRequest, env: "local" | "worktree") => void;
  onClose: () => void;
}) {
  // Remembered, so a small-PR habit sticks: a built-in choice, or "saved:<id>".
  const [picked, setPicked] = usePersistentJson<string>("den.preReviewPick", lastPreReview());
  const { prompts, reload } = useSavedPrompts();
  const [editing, setEditing] = useState<SavedPrompt | "new" | null>(null);
  const savedPick = picked.startsWith("saved:") ? prompts?.find((p) => `saved:${p.id}` === picked) : undefined;
  // A deleted prompt falls back to the full review.
  const choice = picked.startsWith("saved:") && prompts && !savedPick ? "full" : picked;
  const start = (): ReviewStart => ({
    start: choice === "guide" ? "guide" : choice === "none" ? "none" : "review",
    focus: savedPick ? { name: savedPick.name, text: savedPick.text } : choice === "blockers" ? "blockers" : "full",
    owned,
  });
  const remove = async (p: SavedPrompt) => {
    await api(`/api/review-prompts/${encodeURIComponent(p.id)}`, { method: "DELETE" }).catch(() => {});
    reload();
  };
  const option = (value: string, label: string, sub: string, saved?: SavedPrompt) => (
    <label key={value} className="pr-prereview" title={saved?.text}>
      <input type="radio" name="prereview" checked={choice === value} onChange={() => setPicked(value)} />
      <span>
        {label}
        <span className="pr-prereview-sub"> · {sub}</span>
      </span>
      {saved && (
        <span className="pr-prompt-tools">
          <button type="button" className="btn-ghost" title="edit this prompt" onClick={() => setEditing(saved)}>
            ✎
          </button>
          <button type="button" className="btn-ghost" title="delete this prompt" onClick={() => remove(saved)}>
            ×
          </button>
        </span>
      )}
    </label>
  );
  // Not remembered: taking over someone else's PR is a per-PR call.
  const [owned, setOwned] = useState(false);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>
            {pr.isMine ? "Your PR" : "Review PR"} · {pr.repo.split("/")[1]} #
            {pr.number}
          </strong>
          <button className="btn-ghost" onClick={onClose} title="cancel">
            ×
          </button>
        </div>

        <div className="ticket-summary">
          <div className="ticket-summary-title">{pr.title}</div>
          <div className="ticket-summary-meta">
            {pr.checks} checks · {pr.review.replace(/_/g, " ")}
          </div>
        </div>

        {pr.isMine ? (
          <>
            <div className="ticket-branch">
              checkout <code>{pr.branch}</code> to make changes:
            </div>
            <div className="choose-grid">
              <button
                className="choose-card work"
                onClick={() => onEditMine(pr, "worktree")}
              >
                <div className="choose-emoji">🌿</div>
                <div className="choose-text">
                  <div className="choose-title">New workspace</div>
                  <div className="choose-sub">a separate git worktree</div>
                </div>
              </button>
              <button
                className="choose-card other"
                onClick={() => onEditMine(pr, "local")}
              >
                <div className="choose-emoji">💻</div>
                <div className="choose-text">
                  <div className="choose-title">Default local</div>
                  <div className="choose-sub">check out in your work repo</div>
                </div>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="pr-prereview-group" role="radiogroup" aria-label="what Claude does first">
              {BUILT_IN.map(([value, label, sub]) => option(value, label, sub))}
              {(prompts ?? []).map((p) =>
                option(`saved:${p.id}`, p.name, p.text.length > 60 ? `${p.text.slice(0, 57)}...` : p.text, p),
              )}
              {editing ? (
                <PromptEditor
                  key={editing === "new" ? "new" : editing.id}
                  editing={editing === "new" ? null : editing}
                  onSaved={(p) => {
                    setEditing(null);
                    setPicked(`saved:${p.id}`);
                    reload();
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <button type="button" className="btn-ghost pr-prompt-new" onClick={() => setEditing("new")}>
                  + save your own review prompt
                </button>
              )}
              {AFTER.map(([value, label, sub]) => option(value, label, sub))}
            </div>
            <label className="pr-prereview pr-own">
              <input type="checkbox" checked={owned} onChange={(e) => setOwned(e.target.checked)} />
              <span>
                Work on it yourself
                <span className="pr-prereview-sub"> · Claude can edit, commit, push, and post on this PR as if it were yours</span>
              </span>
            </label>
            <button
              className="btn btn-primary"
              style={{ width: "100%" }}
              onClick={() => onReview(pr, start())}
            >
              start review →
            </button>
          </>
        )}
      </div>
    </div>
  );
}
