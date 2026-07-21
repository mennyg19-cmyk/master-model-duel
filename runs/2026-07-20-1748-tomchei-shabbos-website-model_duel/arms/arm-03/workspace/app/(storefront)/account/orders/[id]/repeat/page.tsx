import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomerContext } from "@/lib/auth/customer-session";
import { getOpenSeason } from "@/lib/season";
import { loadRepeatableOrder, buildRepeatPlan } from "@/lib/repeat";
import { RepeatReview } from "@/components/account/repeat-review";

/**
 * The middle review page (UR-007, G-011, G-012): nothing lands in the cart
 * until every replacement and recipient on this page is confirmed. Ownership
 * mirrors the order detail page — foreign ids 404 identically.
 */
export default async function RepeatOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const customer = (await getCustomerContext())!;
  const { id } = await params;

  const season = await getOpenSeason();
  if (!season) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Repeat order</h1>
        <p className="text-sm text-muted">
          The store is closed — repeating opens with the next season.{" "}
          <Link href="/account/orders" className="text-brand hover:underline">Back to your orders</Link>
        </p>
      </div>
    );
  }

  const order = await loadRepeatableOrder(id);
  if (!order || order.customerId !== customer.id || order.status !== "FINALIZED") notFound();

  const plan = await buildRepeatPlan(order, season);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={`/account/orders/${order.id}`} className="text-sm text-brand hover:underline">
          ← Back to {plan.orderLabel}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Repeat {plan.orderLabel}</h1>
        <p className="text-sm text-muted">
          From {plan.sourceSeasonName} into {plan.targetSeasonName}. Review each item and recipient below — nothing is
          added to your cart until you confirm.
        </p>
      </div>
      <RepeatReview plan={plan} />
    </div>
  );
}
