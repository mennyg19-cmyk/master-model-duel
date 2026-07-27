/**
 * What an admin screen shows before anybody has opened a season.
 *
 * Three screens had the same heading-and-sentence block copied out with only
 * the words changed, and they had already drifted apart in spacing. The sentence
 * stays each screen's own, because "there is nothing to drive" and "there is
 * nobody to ring" are the useful part.
 */
export function NoSeason({
  title,
  message,
  testId,
}: {
  title: string;
  message: string;
  testId: string;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-[var(--color-ink-muted)]" data-testid={testId}>
        {message}
      </p>
    </div>
  );
}
