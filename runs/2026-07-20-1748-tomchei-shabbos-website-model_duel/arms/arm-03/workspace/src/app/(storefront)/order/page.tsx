import Link from "next/link";
import { getCurrentSeason, isStoreOpen } from "@/lib/storefront/season";

export default async function OrderGatePage() {
  const season = await getCurrentSeason();
  const storeOpen = isStoreOpen(season);

  if (!storeOpen) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="order-blocked">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Ordering is closed
        </h1>
        <p className="mt-3 text-sm text-[var(--color-ink)]/75">
          The store is not open right now. You can still browse the catalog and past collections.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/catalog" className="rounded-[var(--radius-md)] bg-[var(--color-leaf)] px-4 py-2 text-sm font-semibold text-white">
            Catalog
          </Link>
          <Link href="/archive" className="rounded-[var(--radius-md)] border border-[var(--color-forest)]/20 px-4 py-2 text-sm font-semibold">
            Archive
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="order-open-placeholder">
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
        Order builder
      </h1>
      <p className="mt-3 text-sm text-[var(--color-ink)]/75">
        Cart and checkout land in a later phase. The store is open for {season?.name}.
      </p>
      <Link href="/catalog" className="mt-6 inline-flex rounded-[var(--radius-md)] bg-[var(--color-leaf)] px-4 py-2 text-sm font-semibold text-white">
        Continue browsing
      </Link>
    </main>
  );
}
