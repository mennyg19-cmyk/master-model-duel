// Shared fetch + error extraction for admin client components. Every staff API
// returns `{ error }` on failure; this is the ONE place that convention is read.

export type ApiResult<T> =
  | { ok: true; body: T }
  | { ok: false; error: string; status: number; body: unknown };

export async function apiFetch<T = unknown>(
  url: string,
  options: { method?: string; body?: unknown } = {}
): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    ...(options.body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body) }),
  });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    return {
      ok: false,
      error: body?.error ?? `Request failed (${response.status})`,
      status: response.status,
      body,
    };
  }
  return { ok: true, body: body as T };
}
