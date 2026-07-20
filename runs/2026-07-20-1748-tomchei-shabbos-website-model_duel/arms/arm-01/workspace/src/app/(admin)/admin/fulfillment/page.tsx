import { FulfillmentBoard } from "@/components/fulfillment-board";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function FulfillmentPage() {
  await requirePermission("admin:view");
  const [packages, recentArtifacts] = await Promise.all([
    db.package.findMany({
      where: { isActive: true },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: 200,
      include: {
        fulfillmentMethod: true,
        order: { select: { id: true, orderNumber: true } },
        shippingQuotes: {
          where: { expiresAt: { gt: new Date() } },
          orderBy: { amountCents: "asc" },
        },
        shippingLabels: {
          where: { status: "PURCHASED" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        lines: {
          include: {
            orderLine: {
              select: {
                productNameSnapshot: true,
                skuSnapshot: true,
              },
            },
          },
          orderBy: { id: "asc" },
        },
      },
    }),
    db.printArtifact.findMany({
      orderBy: { createdAt: "desc" },
      take: 24,
      include: { printBatch: { select: { kind: true } } },
    }),
  ]);

  const channels = new Map<
    string,
    { packageCount: number; giftCount: number; groupedSavings: number }
  >();
  for (const entry of packages) {
    const giftCount = entry.lines.reduce((sum, line) => sum + line.quantity, 0);
    const channel = channels.get(entry.fulfillmentMethod.displayName) ?? {
      packageCount: 0,
      giftCount: 0,
      groupedSavings: 0,
    };
    channel.packageCount += 1;
    channel.giftCount += giftCount;
    channel.groupedSavings += Math.max(0, giftCount - 1);
    channels.set(entry.fulfillmentMethod.displayName, channel);
  }
  const filingGroups = [
    ...new Set(packages.map((entry) => entry.fulfillmentMethod.code)),
  ].sort();
  const orders = [
    ...new Map(
      packages.map((entry) => [
        entry.orderId,
        {
          id: entry.orderId,
          label: `Order #${entry.order.orderNumber ?? entry.orderId.slice(-6)}`,
        },
      ]),
    ).values(),
  ];

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
        Fulfillment
      </p>
      <h1 className="mt-2 text-4xl font-black">Package production</h1>
      <p className="mt-2 max-w-3xl text-[var(--muted)]">
        Group, split, print, pack, and send physical packages. PDF production is
        deliberately separate from fulfillment status.
      </p>
      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[...channels.entries()].map(([name, summary]) => (
          <article
            className="rounded-3xl border border-[var(--border)] bg-white p-5"
            key={name}
          >
            <p className="font-black">{name}</p>
            <p className="mt-2 text-3xl font-black">
              {summary.packageCount.toLocaleString()}
            </p>
            <p className="text-sm text-[var(--muted)]">
              packages · {summary.giftCount.toLocaleString()} gifts ·{" "}
              {summary.groupedSavings.toLocaleString()} boxes saved by grouping
            </p>
          </article>
        ))}
      </div>
      <div className="mt-8">
        <FulfillmentBoard
          artifacts={recentArtifacts.map((artifact) => ({
            id: artifact.id,
            label: `${artifact.kind.replaceAll("_", " ")} · ${artifact.filingGroup} · ${artifact.printBatch.kind.replaceAll("_", " ")}`,
          }))}
          filingGroups={filingGroups}
          orders={orders}
          packages={packages.map((entry) => ({
            id: entry.id,
            orderId: entry.orderId,
            orderLabel: `Order #${entry.order.orderNumber ?? entry.orderId.slice(-6)}`,
            recipientName: entry.recipientName,
            method: entry.fulfillmentMethod.displayName,
            isShipping: entry.fulfillmentMethod.isShipping,
            stage: entry.stage,
            version: entry.version,
            quoteSummary:
              entry.shippingQuotes.length > 0
                ? {
                    chargedCents: Math.max(
                      ...entry.shippingQuotes.map((quote) => quote.amountCents),
                    ),
                    purchasedCents: Math.min(
                      ...entry.shippingQuotes.map((quote) => quote.amountCents),
                    ),
                    marginCents:
                      Math.max(
                        ...entry.shippingQuotes.map((quote) => quote.amountCents),
                      ) -
                      Math.min(
                        ...entry.shippingQuotes.map((quote) => quote.amountCents),
                      ),
                  }
                : null,
            label: entry.shippingLabels[0] ?? null,
            lines: entry.lines.map((line) => ({
              id: line.id,
              label: `${line.orderLine.productNameSnapshot} (${line.orderLine.skuSnapshot})`,
              quantity: line.quantity,
            })),
          }))}
        />
      </div>
    </div>
  );
}
