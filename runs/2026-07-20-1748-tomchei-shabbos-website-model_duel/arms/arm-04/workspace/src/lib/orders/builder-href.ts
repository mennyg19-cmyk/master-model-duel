/**
 * Every state of the builder is a URL: which dialog is open, which product is in
 * quick view, and what the last action had to say. The page reads these and the
 * actions redirect to them, so both spell the query string the same way — and a
 * refresh, a back button and a shared link all land on the same screen.
 *
 * `basePath` is a parameter because the POS builder (P6) is the same shell on a
 * different route (R-031).
 */
export const BUILDER_PATH = '/order';

export type BuilderParams = {
  product?: string | null;
  quick?: string | null;
  assign?: string | null;
  add?: string | null;
  editAddress?: string | null;
  zip?: string | null;
  notice?: string | null;
  problem?: string | null;
};

export function builderHref(basePath: string, params: BuilderParams = {}): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }

  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}
