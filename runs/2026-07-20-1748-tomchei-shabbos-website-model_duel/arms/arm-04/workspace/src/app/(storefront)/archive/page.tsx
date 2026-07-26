import Link from 'next/link';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { pastSeasons } from '@/lib/catalog/queries';
import { readStoreState } from '@/lib/store-state';

export const dynamic = 'force-dynamic';

export default async function ArchivePage() {
  const store = await readStoreState();
  const seasons = await pastSeasons(store.season?.year ?? null);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Past collections</h1>
        <p className="text-[var(--color-ink-muted)]">
          Every year we have run, kept for reference. Past seasons are browse-only — nothing here
          can be ordered.
        </p>
      </header>

      {seasons.length === 0 ? (
        <p className="text-[var(--color-ink-muted)]">
          There is no earlier season yet. {store.season ? `${store.season.label} is our first.` : ''}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="archive-years">
          {seasons.map((season) => (
            <li key={season.id}>
              <Card>
                <CardTitle>
                  <Link href={`/archive/${season.year}`} className="underline underline-offset-4">
                    {season.label}
                  </Link>
                </CardTitle>
                <CardDescription>Browse the {season.year} collection.</CardDescription>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
