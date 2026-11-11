// What kind of change each file in a PR is, so a PR's size can count the
// implementation alone. A repo's own .gitattributes wins over den's path
// guesses.
import { isChurnPath } from "./churn.ts";

export type FileKind = "implementation" | "test" | "docs" | "generated";

export interface AttrRule {
  re: RegExp;
  kind: FileKind | null;
}

/** Which attribute sets which kind. `-diff` marks vendored bundles. */
const ATTR_KIND: [RegExp, FileKind][] = [
  [/^(linguist-generated|linguist-vendored|review-generated)(=true)?$/, "generated"],
  [/^-diff$/, "generated"],
  [/^(linguist-documentation|review-documentation)(=true)?$/, "docs"],
  [/^review-test(=true)?$/, "test"],
  [/^review-implementation(=true)?$/, "implementation"],
];
/** An attribute unset or false: the repo says the path isn't generated. */
const ATTR_UNSET = /^(-(linguist-generated|linguist-vendored|linguist-documentation|review-[a-z-]+)|(linguist-[a-z]+|review-[a-z-]+)=false)$/;

/** A gitattributes pattern as a regex over repo-relative paths. */
export function globToRegExp(pattern: string): RegExp {
  let p = pattern.replace(/\/$/, "");
  // A pattern without a slash matches the name at any depth.
  const anchored = p.includes("/");
  p = p.replace(/^\//, "");
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      const slashAfter = p[i + 2] === "/";
      out += slashAfter ? "(?:.*/)?" : ".*";
      i += slashAfter ? 2 : 1;
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${anchored ? "^" : "(?:^|/)"}${out}(?:/.*)?$`);
}

export function parseGitAttributes(text: string): AttrRule[] {
  const rules: AttrRule[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [pattern, ...attrs] = line.split(/\s+/);
    for (const a of attrs) {
      const kind = ATTR_KIND.find(([re]) => re.test(a))?.[1];
      if (kind) rules.push({ re: globToRegExp(pattern), kind });
      else if (ATTR_UNSET.test(a)) rules.push({ re: globToRegExp(pattern), kind: null });
    }
  }
  return rules;
}

const TEST_PATH =
  /(^|\/)(__tests__|__mocks__|tests?|spec|specs|fixtures?|cypress|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|_(test|spec)\.(rb|go|py)$|(^|\/)test_[^/]+\.py$/;
const DOCS_PATH = /\.(md|mdx|rst|adoc)$|(^|\/)docs?\//;

export function fileKind(path: string, rules: AttrRule[] = []): FileKind {
  // Like git, the last matching line decides.
  let unset = false;
  for (let i = rules.length - 1; i >= 0; i--) {
    if (rules[i].re.test(path)) {
      if (rules[i].kind) return rules[i].kind as FileKind;
      unset = true;
      break;
    }
  }
  if (!unset && isChurnPath(path)) return "generated";
  if (TEST_PATH.test(path)) return "test";
  if (DOCS_PATH.test(path)) return "docs";
  return "implementation";
}

export interface PrSize {
  additions: number;
  deletions: number;
  /** Lines in implementation files only. */
  implAdditions: number;
  implDeletions: number;
  /** The file list was cut short (GitHub sends at most 100), so the
   * implementation counts are the full totals instead. */
  partial: boolean;
}

export function prSize(
  files: { path: string; additions: number; deletions: number }[],
  totals: { additions: number; deletions: number; changedFiles: number },
  rules: AttrRule[] = [],
): PrSize {
  const partial = files.length < totals.changedFiles;
  let implAdditions = 0;
  let implDeletions = 0;
  for (const f of files) {
    if (fileKind(f.path, rules) !== "implementation") continue;
    implAdditions += f.additions;
    implDeletions += f.deletions;
  }
  return partial
    ? { additions: totals.additions, deletions: totals.deletions, implAdditions: totals.additions, implDeletions: totals.deletions, partial }
    : { additions: totals.additions, deletions: totals.deletions, implAdditions, implDeletions, partial };
}
