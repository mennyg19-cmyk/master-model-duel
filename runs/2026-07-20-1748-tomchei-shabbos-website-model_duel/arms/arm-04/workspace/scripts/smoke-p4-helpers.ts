import { parseForms, type ParsedForm } from './http-form';

/**
 * The readers the P4 smoke run uses to get answers out of rendered HTML.
 *
 * They are here rather than in `smoke-p4.ts` so that file reads as the customer
 * journey it is checking: a test flow in one place, the string handling that
 * supports it in another.
 */

/** The form a panel or dialog owns, found by the submit button only it renders. */
export function formWith(html: string, pageUrl: string, marker: string): ParsedForm {
  const form = parseForms(html, pageUrl).find((candidate) => candidate.html.includes(marker));
  if (!form) throw new Error(`No form containing ${marker} on ${pageUrl}`);
  return form;
}

export function redirectOf(response: Response, what: string): string {
  const location = response.headers.get('location') ?? response.headers.get('x-action-redirect');
  if (response.status !== 303 || !location) {
    throw new Error(`Expected a redirect after ${what}, got ${response.status}`);
  }
  return decodeURIComponent(location);
}

export function noticeOf(location: string): string {
  return /notice=([^&]*)/.exec(location)?.[1] ?? location;
}

type BuilderCard = { unitsLeft: string; html: string };

export function builderCards(html: string): Record<string, BuilderCard> {
  const cards: Record<string, BuilderCard> = {};

  for (const chunk of html.split('data-testid="builder-product"').slice(1)) {
    const slug = /data-slug="([^"]*)"/.exec(chunk)?.[1] ?? '';
    cards[slug] = { unitsLeft: /data-units-left="([^"]*)"/.exec(chunk)?.[1] ?? '', html: chunk };
  }

  return cards;
}

/**
 * The cart is rendered twice — pinned sidebar and phone sheet — so lines are read
 * from the sidebar copy alone, or every line would be counted twice.
 */
export function cartLines(html: string): { id: string; assigned: string }[] {
  return sidebar(html)
    .split('data-testid="cart-line"')
    .slice(1)
    .map((chunk) => ({
      id: /data-line-id="([^"]*)"/.exec(chunk)?.[1] ?? '',
      assigned: /data-assigned="([^"]*)"/.exec(chunk)?.[1] ?? '',
    }));
}

export function countOf(html: string, testId: string, attribute: string): number {
  const section = html.slice(html.indexOf(`data-testid="${testId}"`));
  return Number(new RegExp(`data-${attribute}="(\\d+)"`).exec(section)?.[1] ?? -1);
}

export function referenceOf(html: string): string {
  return /data-testid="draft-reference">([^<]*)</.exec(sidebar(html))?.[1] ?? '';
}

export function centsOf(html: string, testId: string): number {
  const shown = new RegExp(`data-testid="${testId}">([^<]*)<`).exec(sidebar(html))?.[1] ?? '';
  return Math.round(Number(shown.replace(/[^0-9.]/g, '')) * 100);
}

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function countOccurrences(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

function sidebar(html: string): string {
  const start = html.indexOf('data-testid="cart-sidebar"');
  const end = html.indexOf('id="cart-sheet"');
  return start === -1 ? '' : html.slice(start, end === -1 ? undefined : end);
}
