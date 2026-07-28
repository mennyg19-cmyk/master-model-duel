// Client-side fetch helper: JSON in, JSON out, never throws on a bad body.
// `body.error` is the API's failure message when `ok` is false.
export async function apiFetch<T = Record<string, unknown>>(
  path: string,
  options: { method?: string; body?: Record<string, unknown> } = {},
): Promise<{ ok: boolean; status: number; body: T & { error?: string } }> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  return { ok: response.ok, status: response.status, body };
}
