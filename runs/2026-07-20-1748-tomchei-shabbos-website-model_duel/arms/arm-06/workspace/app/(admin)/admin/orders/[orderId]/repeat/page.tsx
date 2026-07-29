import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildRepeatPlan } from "@/lib/repeat/plan";
import { getOpenSeason } from "@/lib/seasons/queries";
import { BackLink } from "@/components/admin/back-link";
import { RepeatReview } from "@/components/repeat/repeat-review";

export const metadata: Metadata = { title: "Repeat with review" };
export const dynamic = "force-dynamic";

// P10 (R-057): staff single-order repeat with the review step — replacement
// picks and recipient confirmation land in a fresh draft on the customer's
// account. Finalized orders only (a DRAFT source is already current-season
// state). The one-click repeat (no review) stays on the order page.
export default async function AdminRepeatPage({ params }: { params: Promise<{ orderId: string }> }) {
  await requirePermission("payments.manage");
  const { orderId } = await params;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, draftRef: true, wireFormat: true, customer: { select: { name: true } } },
  });
  if (!order || order.status !== "FINALIZED") notFound();

  const openSeason = await getOpenSeason();
  if (!openSeason) {
    return (
      <div>
        <BackLink href={`/admin/orders/${order.id}`} label="Back to order" />
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          No open season — repeat resumes when a season opens.
        </p>
      </div>
    );
  }

  const plan = await buildRepeatPlan(order.id);
  return (
    <div>
      <BackLink href={`/admin/orders/${order.id}`} label="Back to order" />
      <h2 className="mt-2 text-lg font-semibold text-stone-900">
        Repeat {order.wireFormat ?? order.draftRef ?? "order"} for {order.customer.name}
      </h2>
      <p className="mt-1 text-sm text-stone-500">
        Review replacements and recipients; confirm creates a draft on the customer&apos;s account.
      </p>
      <RepeatReview
        plan={plan}
        confirmUrl={`/api/admin/orders/${order.id}/repeat`}
        doneHrefPrefix="/admin/orders?draft="
        staff
      />
    </div>
  );
}
