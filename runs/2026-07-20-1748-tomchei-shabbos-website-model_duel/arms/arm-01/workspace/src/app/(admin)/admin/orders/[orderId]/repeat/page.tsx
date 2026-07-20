import { notFound } from "next/navigation";
import { RepeatReview } from "@/components/repeat-review";
import { getRepeatReview } from "@/domain/repeat-orders";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function StaffRepeatReviewPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requirePermission("orders:manage");
  const { orderId } = await params;
  const source = await db.order.findFirst({
    where: { id: orderId, status: "FINALIZED" },
    select: { id: true },
  });
  if (!source) notFound();
  const review = await getRepeatReview(db, orderId);

  return (
    <RepeatReview
      addresses={review.addresses.map((address) => ({
        id: address.id,
        recipientName: address.recipientName,
        line1: address.line1,
      }))}
      lines={review.lines}
      mode="staff"
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
