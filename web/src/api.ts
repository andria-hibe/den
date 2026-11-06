// Throws on non-2xx, with the server's {error|message} when present, and its
// `error` code as the thrown error's `code`.
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  // Only set a JSON content-type when there's actually a body — Fastify rejects
  // an empty body when content-type is application/json (breaks DELETE).
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const j = await res.json();
      if (j?.message || j?.error) msg = j.message || j.error;
      if (typeof j?.error === "string") code = j.error;
    } catch {
      // no JSON body
    }
    throw Object.assign(new Error(msg), { code });
  }
  return res.json() as Promise<T>;
}
