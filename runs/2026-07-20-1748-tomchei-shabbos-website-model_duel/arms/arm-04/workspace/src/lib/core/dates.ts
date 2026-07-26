/** One date library for the whole project: the platform Intl API. No moment, no dayjs. */

export const ORG_TIME_ZONE = 'America/New_York';

export function formatDateTime(date: Date, timeZone: string = ORG_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
