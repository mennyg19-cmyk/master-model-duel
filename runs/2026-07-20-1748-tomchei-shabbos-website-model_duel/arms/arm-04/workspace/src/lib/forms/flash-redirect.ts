import { redirect } from 'next/navigation';

/**
 * Every server action ends the same way: back to a screen, with one line about
 * what happened. Each action spelling that query string for itself is how five
 * of them ended up with five encodings, one of which interpolated a form field
 * straight into the URL.
 *
 * Values go through `URLSearchParams`, so an `&` or a `#` — in a message, or in
 * a filter a form posted back — cannot add, forge or truncate a parameter.
 */
export type FlashParams = Record<string, string | null | undefined>;

export function flashHref(basePath: string, params: FlashParams = {}): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }

  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function redirectWithFlash(basePath: string, params: FlashParams = {}): never {
  redirect(flashHref(basePath, params));
}

/**
 * An action that could not do what it was asked, sent back to the screen that
 * asked. `problem` is the one key `FlashMessages` reads, so a message written
 * under any other name is a message the office never sees.
 */
export function rejectWith(basePath: string, message: string): never {
  redirectWithFlash(basePath, { problem: message });
}
