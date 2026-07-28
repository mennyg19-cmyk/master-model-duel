import type { Metadata } from "next";
import Link from "next/link";
import { getOpenSeason } from "@/lib/seasons/queries";
import { ClosedNotice } from "@/components/storefront/closed-notice";

export const metadata: Metadata = { title: "Order" };
export const dynamic = "force-dynamic";

// R-002: closure enforcement — the route exists now so the gate is real, the
// cart-first builder lands in P4 on top of it.
export default async function OrderPage() {
  const openSeason = await getOpenSeason();
  if (!openSeason) {
    return <ClosedNotice attempted="Ordering" />;
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold text-stone-900">Start an order</h1>
      <p className="mt-4 text-stone-600">
        The order builder opens with cart checkout in the next release. Until then, browse the{" "}
        <Link href="/packages" className="font-medium text-brand-700 underline">
          season {openSeason.name} catalog
        </Link>{" "}
        and note the packages you&apos;d like.
      </p>
    </main>
  );
}
