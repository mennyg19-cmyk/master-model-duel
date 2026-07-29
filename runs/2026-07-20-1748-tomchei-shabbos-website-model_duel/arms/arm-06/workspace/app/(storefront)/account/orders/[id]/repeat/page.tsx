import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCustomer } from "@/lib/customers/session";
import { buildRepeatPlan } from "@/lib/repeat/plan";
import { getOpenSeason } from "@/lib/seasons/queries";
import { RepeatReview } from "@/components/repeat/repeat-review";

export const metadata: Metadata = { title: "Repeat this order" };
export const dynamic = "force-dynamic";

// P10 (UR-007/G-012): customer repeat — the middle review page. Replacements
// (chain-resolved or price-smart picks) and recipients are confirmed here
// before anything becomes a draft. Finalized orders only (including imported
// prior-year orders — no draftRef required); a DRAFT source is already
// current-season state and repeating it just duplicates the order.
export default async function RepeatOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCustomer();
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, customerId: true, status: true, draftRef: true, wireFormat: true },
  });
  if (!order || order.customerId !== ctx.customer.id || order.status !== "FINALIZED") notFound();

  const openSeason = await getOpenSeason();
  if (!openSeason) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-stone-900">Repeat this order</h2>
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          The store is between seasons right now — check back when the new catalog opens.
        </p>
      </div>
    );
  }

  const plan = await buildRepeatPlan(order.id);
  return (
    <div>
      <h2 className="text-lg font-semibold text-stone-900">
        Repeat {order.wireFormat ?? order.draftRef ?? `order #${plan.sourceOrderNumber ?? ""}`} into {plan.targetSeasonName}
      </h2>
      <p className="mt-1 text-sm text-stone-500">
        Confirm this year&apos;s replacements and your recipients — nothing is ordered yet.{" "}
        <Link href={`/account/orders/${order.id}`} className="text-brand-700 underline">
          Back to the order
        </Link>
      </p>
      <RepeatReview
        plan={plan}
        confirmUrl={`/api/orders/${order.id}/repeat`}
        doneHrefPrefix="/order?draft="
      />
    </div>
  );
}
