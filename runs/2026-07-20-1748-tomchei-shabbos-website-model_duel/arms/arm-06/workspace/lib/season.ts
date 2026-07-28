// Purim falls in Feb/Mar, so the season is named for the gregorian year of the
// coming Purim: anything from April onward belongs to next year's season.
export function getSeasonYear(date: Date): number {
  return date.getMonth() >= 3 ? date.getFullYear() + 1 : date.getFullYear();
}
