/**
 * Wall-clock time in the organisation's own timezone.
 *
 * A manager scheduling "open at 8am on the first of Adar" means eight in the
 * morning where the office is, not in UTC and not on the laptop that happened to
 * type it. Every scheduled season flip is stored as an instant and entered as a
 * wall clock, and this is the only place the two are converted.
 *
 * `Intl` does the timezone work — no dependency, and the rules travel with the
 * Node build rather than with a table this project would have to update twice a
 * year.
 */
export const DEFAULT_TIME_ZONE = 'America/New_York';

/** The shape an `<input type="datetime-local">` posts and reads. */
const WALL_CLOCK_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Null for anything that is not a complete `YYYY-MM-DDTHH:mm`, which is what a
 * cleared date field posts.
 *
 * The offset is applied twice on purpose. The first pass uses the offset at the
 * naive instant, which is wrong by an hour for a time on the far side of a
 * daylight-saving change; the second uses the offset at the instant the first
 * pass produced, which is right.
 */
export function wallClockToUtc(wallClock: string, timeZone: string): Date | null {
  const match = WALL_CLOCK_PATTERN.exec(wallClock.trim());
  if (!match) return null;

  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);

  const firstPass = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  return new Date(naive - zoneOffsetMs(firstPass, timeZone));
}

export function utcToWallClock(instant: Date, timeZone: string): string {
  const parts = zoneParts(instant, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * "Sun, Mar 1, 2026 at 8:00 AM EST" — what the screen says a schedule means.
 *
 * Spelled out field by field rather than with `dateStyle`/`timeStyle`, which
 * `Intl` refuses to combine with `timeZoneName` — and the zone is the whole
 * point of the line.
 */
export function formatInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(instant);
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zoneParts(instant, timeZone);
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function zoneParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00';

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}
