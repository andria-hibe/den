// Den's server is a *local* control plane: it can spawn shells, read/write files
// under $HOME, and drive `git`/`gh`. It binds to loopback only (127.0.0.1), so
// it isn't reachable across the network — but two browser-based attacks can still
// reach a loopback server from a page the user is visiting:
//
//   • Cross-Site WebSocket Hijacking (CSWSH): a malicious page opens
//     ws://127.0.0.1:<port>/ws/terminal and drives a PTY. Browsers do NOT apply
//     the same-origin policy to WebSocket connections, so nothing stops this
//     unless the server checks the Origin header itself.
//   • DNS rebinding: an attacker domain re-resolves to 127.0.0.1, so the victim's
//     browser sends requests to the local server while believing it's talking to
//     the attacker's site. The tell is the Host header — it carries the attacker's
//     domain, not a loopback address.
//
// Both are defeated by refusing any request whose Origin or Host isn't loopback.
// Non-browser clients (curl, the Vite dev proxy, top-level navigations) send no
// Origin header at all; those are allowed — the browser cross-origin threat only
// exists when an Origin *is* present and points somewhere else.

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostnameOf(hostHeader: string): string | null {
  // Host is "hostname" or "hostname:port" (no scheme); URL needs one.
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function originIsLoopback(origin: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * True if a request is safe to serve: its Host is a loopback address (blocks DNS
 * rebinding) and, if it carries an Origin, that Origin is also loopback (blocks
 * cross-site WebSocket/fetch hijacking). A missing Origin is fine — that means a
 * non-browser client or a same-document navigation, neither of which is the
 * cross-origin threat this guards against.
 */
export function isLocalRequest(headers: {
  origin?: string;
  host?: string;
}): boolean {
  const host = headers.host;
  if (!host) return false; // HTTP/1.1 requires Host; absence is suspicious.
  const hostname = hostnameOf(host);
  if (!hostname || !LOOPBACK_HOSTS.has(hostname)) return false;

  const origin = headers.origin;
  if (origin && origin !== "null" && !originIsLoopback(origin)) return false;

  return true;
}
