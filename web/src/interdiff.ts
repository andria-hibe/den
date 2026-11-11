// What a PR changed since its last review, from the diff the review was
// written against and the PR's current diff. Hunks are compared by their
// lines, not their @@ positions, so a rebase or force push that only moves
// code around the change doesn't make the whole PR look new.

interface FileDiff {
  /** The `diff --git` line: one per file, the same in both diffs. */
  key: string;
  path: string;
  /** Everything before the first hunk: the diff --git line, index, ---/+++. */
  header: string;
  hunks: string[];
}

function parse(diff: string): FileDiff[] {
  const out: FileDiff[] = [];
  for (const chunk of diff.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith("diff --git ")) continue;
    const key = chunk.slice(0, chunk.indexOf("\n"));
    // Git quotes a path with unusual characters: diff --git "a/x" "b/x".
    const m = /^diff --git (?:"a\/.*" "b\/(.*)"|a\/.* b\/(.*))$/.exec(key);
    const path = m?.[1] ?? m?.[2] ?? key;
    const parts = chunk.split(/^(?=@@ )/m);
    out.push({ key, path, header: parts[0], hunks: parts.slice(1) });
  }
  return out;
}

/** A hunk's identity: its changed and context lines without the @@ header. */
const body = (hunk: string) => hunk.slice(hunk.indexOf("\n") + 1).trimEnd();

export interface SinceLastReview {
  /** The current diff cut down to new or changed hunks, for the diff view. */
  diff: string;
  /** Files with new or changed hunks. */
  changed: string[];
  /** Files the last review saw that the PR no longer changes. */
  dropped: string[];
}

export function sinceLastReview(prev: string, next: string): SinceLastReview {
  const before = new Map(parse(prev).map((f) => [f.key, f]));
  const now = parse(next);
  let diff = "";
  const changed: string[] = [];
  for (const f of now) {
    const old = before.get(f.key);
    const seen = new Set(old?.hunks.map(body));
    const fresh = f.hunks.filter((h) => !seen.has(body(h)));
    // A binary or mode-only change has no hunks; its index line still moves.
    const same = f.hunks.length ? fresh.length === 0 : old?.header === f.header;
    if (same) continue;
    changed.push(f.path);
    diff += f.header + fresh.join("");
  }
  const current = new Set(now.map((f) => f.key));
  return { diff, changed, dropped: [...before.values()].filter((f) => !current.has(f.key)).map((f) => f.path) };
}
