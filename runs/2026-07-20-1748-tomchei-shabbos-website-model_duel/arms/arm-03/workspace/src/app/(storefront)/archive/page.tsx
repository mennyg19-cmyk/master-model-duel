import Link from "next/link";
import { listArchiveSeasons } from "@/lib/storefront/season";

export default async function ArchiveIndexPage() {
  const seasons = await listArchiveSeasons();
  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="font-[family-name:var(--font-display)] text-4xl text-[var(--color-forest)]">
        Past collections
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink)]/70">
        Browse prior seasons. Checkout is never available from the archive.
      </p>
      {seasons.length === 0 ? (
        <p className="mt-8 text-sm">No closed seasons yet.</p>
      ) : (
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 md:grid-cols-3" data-testid="archive-years">
          {seasons.map((season) => (
            <li key={season.id}>
              <Link
                href={`/archive/${season.slug}`}
                className="block rounded-[var(--radius-lg)] border border-[var(--color-forest)]/10 bg-white p-4 hover:border-[var(--color-leaf)]"
              >
                <p className="font-semibold text-[var(--color-forest)]">{season.name}</p>
                <p className="text-sm text-[var(--color-ink)]/60">{season.year}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
