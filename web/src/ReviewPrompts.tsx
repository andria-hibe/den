// The developer's saved review prompts (server/reviewPrompts.ts): listed in
// the PR dialog beside Full and Blockers only, and edited there.
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";
import type { SavedPrompt } from "../../server/reviewPrompts.ts";

export function useSavedPrompts() {
  const [prompts, setPrompts] = useState<SavedPrompt[] | null>(null);
  const reload = useCallback(() => {
    api<{ prompts: SavedPrompt[] }>("/api/review-prompts")
      .then((d) => setPrompts(d.prompts))
      .catch(() => setPrompts([]));
  }, []);
  useEffect(reload, [reload]);
  return { prompts, reload };
}

/** Add a prompt, or edit `editing`. */
export function PromptEditor({
  editing,
  onSaved,
  onCancel,
}: {
  editing: SavedPrompt | null;
  onSaved: (p: SavedPrompt) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [text, setText] = useState(editing?.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const { prompt } = await api<{ prompt: SavedPrompt }>("/api/review-prompts", {
        method: "POST",
        body: JSON.stringify({ id: editing?.id, name, text }),
      });
      onSaved(prompt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="prompt-editor">
      <input
        className="prompt-editor-field"
        placeholder="name, e.g. Migrations"
        value={name}
        maxLength={40}
        autoFocus
        onChange={(e) => setName(e.target.value)}
      />
      <textarea
        className="prompt-editor-field"
        rows={4}
        placeholder="What the review should focus on. It runs on top of the full review's rules."
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
      />
      {error && <div className="prompt-editor-error">{error}</div>}
      <div className="prompt-editor-actions">
        <button className="btn btn-ghost-outline" onClick={onCancel}>
          cancel
        </button>
        <button className="btn btn-primary" disabled={saving || !name.trim() || !text.trim()} onClick={save}>
          save
        </button>
      </div>
    </div>
  );
}
