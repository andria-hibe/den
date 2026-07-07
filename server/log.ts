// One place for server-side diagnostics. Kept deliberately small: den has no
// logging framework, but silently swallowing errors (empty `catch {}`) makes
// gh/git/Linear failures invisible when something misbehaves. Log the context +
// error to stderr; never log secrets (API keys, tokens) — pass only the error.

/** Log a non-fatal error with a short context tag, e.g. logWarn("gh.prs", err). */
export function logWarn(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[den] ${context}: ${msg}`);
}
