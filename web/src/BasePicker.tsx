import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { stackCandidates } from "./stackBase.ts";
import type { Worktree } from "../../server/git.ts";

/** The work repo's worktrees and base branch name, for the base picker. */
export function useWorkBases() {
  const [data, setData] = useState<{ base: string | null; worktrees: Worktree[] } | null>(null);
  useEffect(() => {
    api<{ base: string | null; worktrees: Worktree[] }>("/api/git/worktrees")
      .then(setData)
      .catch(() => setData({ base: null, worktrees: [] }));
  }, []);
  return data;
}

// "Start from": the repo's base branch by default, or another branch you have
// open, so a ticket that builds on another one gets that ticket's code (#26).
// Hidden when there is nothing to pick. `value` null means the repo base.
export function BasePicker({
  base,
  worktrees,
  creating,
  value,
  onChange,
}: {
  base: string | null;
  worktrees: Worktree[];
  /** The branch being created, which can't be its own base. */
  creating: string | null | undefined;
  value: string | null;
  onChange: (branch: string | null) => void;
}) {
  const options = stackCandidates(worktrees, creating, base);
  if (options.length === 0) return null;
  return (
    <label className="base-picker">
      <span>start from</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{base ? `${base} (the repo base)` : "the repo's base branch"}</option>
        {options.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
    </label>
  );
}
