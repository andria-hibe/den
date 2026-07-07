// Thin fetch wrapper: throws on non-2xx, surfacing the server's {error|message}
// when present. Used across the app so callers can just try/catch.
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  // Only set a JSON content-type when there's actually a body — Fastify rejects
  // an empty body when content-type is application/json (breaks DELETE).
  const headers = init?.body ? { "content-type": "application/json" } : undefined;
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.message || j?.error) msg = j.message || j.error;
    } catch {
      // no JSON body
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}
