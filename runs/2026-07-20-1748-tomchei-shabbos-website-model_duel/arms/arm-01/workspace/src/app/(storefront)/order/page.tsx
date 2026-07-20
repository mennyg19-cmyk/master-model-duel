import Link from "next/link";
import { getDeliveryZips } from "@/lib/store-settings";
import { getCurrentSeason } from "@/lib/storefront";

export const dynamic = "force-dynamic";

export default async function OrderGatePage({
  searchParams,
}: {
  searchParams: Promise<{ zip?: string }>;
}) {
  const [{ zip }, season, deliveryZips] = await Promise.all([
    searchParams,
    getCurrentSeason(),
    getDeliveryZips(),
  ]);
  const isOpen = season?.status === "OPEN";
  const isDeliveryZipAllowed = !zip || deliveryZips.includes(zip.trim());

  return (
    <main className="grid min-h-[60vh] place-items-center bg-[var(--cream)] px-5 py-20">
      <div className="max-w-xl rounded-[2rem] border border-[var(--border)] bg-white p-9 text-center shadow-xl">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
          Order access
        </p>
        {!isOpen ? (
          <>
            <h1 className="mt-4 text-3xl font-black">Ordering is closed</h1>
            <p className="mt-4 leading-7 text-[var(--muted)]">
              The {season?.year} season is browse-only. No order can be started
              while the season is closed.
            </p>
          </>
        ) : !isDeliveryZipAllowed ? (
          <>
            <h1 className="mt-4 text-3xl font-black">Delivery is unavailable to {zip}</h1>
            <p className="mt-4 leading-7 text-[var(--muted)]">
              That postal code is outside the current delivery area. This check
              uses the latest staff settings.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-3xl font-black">Your gift is ready to build</h1>
            <p className="mt-4 leading-7 text-[var(--muted)]">
              The season and delivery area are open. The cart-first order builder
              arrives in the next release.
            </p>
          </>
        )}
        <Link
          className="mt-7 inline-block rounded-full bg-[var(--ink)] px-6 py-3 font-bold text-white"
          href={isOpen ? "/catalog" : "/collections"}
        >
          {isOpen ? "Return to gifts" : "Browse the archive"}
        </Link>
      </div>
    </main>
  );
}
