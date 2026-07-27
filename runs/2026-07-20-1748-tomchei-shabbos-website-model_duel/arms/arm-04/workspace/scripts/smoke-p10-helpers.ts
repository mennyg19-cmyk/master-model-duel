import { parseForms, type ParsedForm } from './http-form';

/**
 * The readers the P10 smoke run uses to get answers out of rendered HTML.
 *
 * They live here so `smoke-p10.ts` reads as the season it is checking — a family
 * repeating last year's order, an office starting next year — rather than as a
 * pile of regular expressions.
 */

export function locationOf(response: Response, what: string): string {
  const location = response.headers.get('location') ?? response.headers.get('x-action-redirect');
  if (response.status !== 303 || !location) {
    throw new Error(`Expected a redirect after ${what}, got ${response.status}`);
  }
  return location;
}

/** The one line a server action leaves on the screen it sends you back to. */
export function flashOf(location: string, key: 'notice' | 'problem'): string {
  return new URL(location, 'http://smoke.invalid').searchParams.get(key) ?? '';
}

export type RepeatLineView = {
  lineId: string;
  resolution: string;
  recipientState: string;
  recipient: string;
  greeting: string | null;
  suggestedProductId: string | null;
  html: string;
};

export function repeatLines(html: string): RepeatLineView[] {
  return chunksOf(html, 'repeat-line').map((chunk) => ({
    lineId: attribute(chunk, 'value') ?? '',
    resolution: dataOf(chunk, 'resolution'),
    recipientState: dataOf(chunk, 'recipient-state'),
    recipient: textOf(chunk, 'repeat-recipient'),
    greeting: chunk.includes('data-testid="repeat-greeting"') ? textOf(chunk, 'repeat-greeting') : null,
    suggestedProductId:
      /<option value="([^"]+)"[^>]*>[^<]*closest to what you paid/.exec(chunk)?.[1] ?? null,
    html: chunk,
  }));
}

export type ReplacementRowView = { slug: string; resolution: string; html: string };

export function replacementRows(html: string): ReplacementRowView[] {
  return chunksOf(html, 'replacement-row').map((chunk) => ({
    slug: dataOf(chunk, 'slug'),
    resolution: dataOf(chunk, 'resolution'),
    html: chunk,
  }));
}

export type SeasonCardView = { year: string; status: string; schedule: string; html: string };

export function seasonCards(html: string): SeasonCardView[] {
  return chunksOf(html, 'season-card').map((chunk) => ({
    year: dataOf(chunk, 'year'),
    status: /<span[^>]*>(OPEN|CLOSED)<\/span>/.exec(chunk)?.[1] ?? '',
    schedule: textOf(chunk, 'season-schedule-summary'),
    html: chunk,
  }));
}

/** The form inside one season's card, told apart by a marker only it carries. */
export function formIn(html: string, pageUrl: string, criteria: Record<string, string>, marker: string): ParsedForm {
  const form = parseForms(html, pageUrl).find(
    (candidate) =>
      candidate.html.includes(marker) &&
      Object.entries(criteria).every(([name, value]) => candidate.fields[name] === value),
  );

  if (!form) throw new Error(`No form on ${pageUrl} matching ${JSON.stringify(criteria)} and ${marker}`);
  return form;
}

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * One chunk per card: everything from that card's marker to the next card's.
 * Enough to read a card's own attributes, text and options out of a list of
 * them, without the run having to carry an HTML parser.
 *
 * React separates adjacent text nodes with an empty comment, so `Card: “{msg}”`
 * arrives as three pieces. They are stitched back together first, because every
 * reader below wants the sentence a person would see.
 */
function chunksOf(html: string, testId: string): string[] {
  return html.replaceAll('<!-- -->', '').split(`data-testid="${testId}"`).slice(1);
}

function dataOf(chunk: string, attribute: string): string {
  return new RegExp(`data-${attribute}="([^"]*)"`).exec(chunk)?.[1] ?? '';
}

function attribute(chunk: string, name: string): string | null {
  return new RegExp(`${name}="([^"]*)"`).exec(chunk)?.[1] ?? null;
}

function textOf(chunk: string, testId: string): string {
  const start = chunk.indexOf(`data-testid="${testId}"`);
  if (start === -1) return '';
  const rest = chunk.slice(start);
  return />([^<]*)</.exec(rest)?.[1].trim() ?? '';
}
