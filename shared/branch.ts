// Branch names flow in from Linear / PR data and the New Session dialog, and are
// passed as positional args to git. All git calls use execFile (no shell), so
// there's no command injection — but a value starting with "-" could still be
// misread as a git flag. Restrict to git's safe ref charset and reject a leading
// dash before using one.
//
// Shared (like shared/colors.ts) so the dialog can reject a bad branch name
// before the round-trip, without a second copy of the rule to drift.
const BRANCH_RE = /^[A-Za-z0-9._/][A-Za-z0-9._/-]*$/;

export function isValidBranch(branch: string): boolean {
  return BRANCH_RE.test(branch) && !branch.includes("..");
}
