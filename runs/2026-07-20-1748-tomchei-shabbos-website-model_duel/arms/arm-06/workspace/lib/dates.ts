// Time-span constants — the one place day/hour/minute-in-millis lives, so
// sweeps, link TTLs, and lock windows never re-spell the magic value.

export const MILLIS_PER_MINUTE = 60 * 1000;
export const MILLIS_PER_HOUR = 60 * MILLIS_PER_MINUTE;
export const MILLIS_PER_DAY = 24 * MILLIS_PER_HOUR;
