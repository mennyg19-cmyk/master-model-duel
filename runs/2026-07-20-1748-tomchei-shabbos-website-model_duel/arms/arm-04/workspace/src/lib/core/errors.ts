/**
 * The one line of an error that is safe to keep.
 *
 * A driver error or a stack trace can carry connection strings and row
 * contents, and both the cron log and the notification attempt trail are read
 * by staff. So the first line is kept, cut to a length a table can show, and
 * the rest is dropped.
 */
export const MAX_STORED_ERROR_LENGTH = 200;

export function firstErrorMessage(error: unknown, maxLength = MAX_STORED_ERROR_LENGTH): string {
  if (!(error instanceof Error)) return 'unknown error';

  return error.message.split('\n')[0].slice(0, maxLength);
}
