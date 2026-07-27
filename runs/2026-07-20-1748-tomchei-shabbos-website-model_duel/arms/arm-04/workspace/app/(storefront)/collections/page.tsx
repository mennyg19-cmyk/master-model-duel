import Link from "next/link";
import { getArchiveSeasons } from "@/lib/season";
import { db } from "@/lib/db";

export default async function CollectionsPage() {
  const seasons = await getArchiveSeasons();
  const productCounts = await db.product.groupBy({
    by: ["seasonId"],
    where: { seasonId: { in: seasons.map((season) => season.id) } },
    _count: true,
  });
  const countBySeason = new Map(productCounts.map((row) => [row.seasonId, row._count]));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold">Past collections</h1>
      <p className="mt-2 text-muted">
        A look back at every season&apos;s mishloach manos. Browse only — past packages can&apos;t be ordered.
      </p>
      {seasons.length === 0 ? (
        <p className="py-16 text-center text-muted">No archived seasons yet.</p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {seasons.map((season) => (
            <li key={season.id}>
              <Link
                href={`/collections/${season.id}`}
                className="block rounded-lg border border-border bg-surface p-5 shadow-sm hover:border-brand"
              >
                <h2 className="text-lg font-semibold">{season.name}</h2>
                <p className="mt-1 text-sm text-muted">
                  {countBySeason.get(season.id) ?? 0} packages · view the collection
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
