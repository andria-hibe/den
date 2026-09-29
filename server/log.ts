// Server-side diagnostics to stderr, so gh/git/Linear failures aren't
// swallowed silently. Never log secrets (API keys, tokens): pass only the error.

/** Log a non-fatal error with a short context tag, e.g. logWarn("gh.prs", err). */
export function logWarn(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[den] ${context}: ${msg}`);
}
