import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';

/**
 * One number under one label: the row of cards at the top of a report, the
 * margin view and an import run.
 *
 * `tone` colours the number itself — a count of rows that cannot be read is
 * worth seeing in warning colour. `note` is a line under it, for the caveat
 * that would otherwise be squeezed into the label.
 */
export function Figure({
  label,
  value,
  note,
  tone,
  testId,
}: {
  label: string;
  value: string;
  note?: string | null;
  tone?: 'warning';
  testId?: string;
}) {
  return (
    <Card>
      <dt className="text-sm text-[var(--color-ink-muted)]">{label}</dt>
      <dd
        className={cn('mt-1 text-xl font-semibold', tone === 'warning' && 'text-[var(--color-warning)]')}
        data-testid={testId}
      >
        {value}
      </dd>
      {note ? <p className="mt-1 text-xs text-[var(--color-warning)]">{note}</p> : null}
    </Card>
  );
}
