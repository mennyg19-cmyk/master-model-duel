import { notFound } from "next/navigation";
import { RepeatReview } from "@/components/repeat-review";
import { getRepeatReview } from "@/domain/repeat-orders";
import { getAuthenticatedCustomer } from "@/lib/customer-access";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CustomerRepeatReviewPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const [{ orderId }, account] = await Promise.all([
    params,
    getAuthenticatedCustomer(),
  ]);
  if (!account?.customerId) notFound();
  const source = await db.order.findFirst({
    where: { id: orderId, customerId: account.customerId, status: "FINALIZED" },
    select: { id: true },
  });
  if (!source) notFound();
  const review = await getRepeatReview(db, orderId);
  if (review.targetSeason.status !== "OPEN") notFound();

  return (
    <RepeatReview
      addresses={review.addresses.map((address) => ({
        id: address.id,
        recipientName: address.recipientName,
        line1: address.line1,
      }))}
      lines={review.lines}
      mode="customer"
      sourceOrder={{
        id: review.sourceOrder.id,
        version: review.sourceOrder.version,
        customerName: review.sourceOrder.customerName,
        seasonName: review.sourceOrder.season.name,
      }}
      targetSeason={{ name: review.targetSeason.name }}
    />
  );
}
