import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CHANNEL_LABELS, formatBatchTimestamp } from "@/lib/packages/fulfillment";
import { canAdvanceStage, parseMethodStages } from "@/lib/packages/stages";
import { Card, CardTitle } from "@/components/ui/card";
import { BackLink } from "@/components/admin/back-link";
import { PackageStageBadge } from "@/components/admin/order-badges";
import { PackageActions } from "@/app/(admin)/admin/packages/[packageId]/package-actions";
import type { PackageStage } from "@prisma/client";

export const metadata: Metadata = { title: "Package detail" };
export const dynamic = "force-dynamic";

const PACKAGE_EVENTS_LIMIT = 25;

// UR-001: one physical package — contents, stage advance (forward-only inside
// the method's stage list), split/regroup, print history. Printing a batch
// never moves the stage (G-004): the "print" events here are informational.
export default async function AdminPackageDetailPage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  await requirePermission("fulfillment.manage");
  const { packageId } = await params;

  const pkg = await prisma.package.findUnique({
    where: { id: packageId },
    include: {
      fulfillmentMethod: true,
      order: { select: { id: true, wireFormat: true, draftRef: true } },
      recipientAddress: true,
      lines: {
        orderBy: { id: "asc" },
        include: { orderLine: { select: { productName: true, optionLabel: true, addOnId: true, parentLineId: true } } },
      },
      events: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PACKAGE_EVENTS_LIMIT },
      batchItems: {
        orderBy: { id: "desc" },
        include: { batch: { select: { id: true, filingGroup: true, trigger: true, createdAt: true } } },
      },
    },
  });
  if (!pkg) notFound();

  const methodStages = parseMethodStages(pkg.fulfillmentMethod.stages, pkg.fulfillmentMethod.code);
  const nextStages = methodStages.filter((stage) => canAdvanceStage(pkg.stage, stage, methodStages));

  const siblings = await prisma.package.findMany({
    where: { orderId: pkg.orderId, id: { not: pkg.id }, stage: { not: pkg.fulfillmentMethod.terminalStage } },
    select: { id: true, recipientName: true, stage: true, _count: { select: { lines: true } } },
    orderBy: { createdAt: "asc" },
  });

  const orderRef = pkg.order.wireFormat ?? pkg.order.draftRef ?? pkg.order.id;

  const actorIds = [...new Set(pkg.events.map((event) => event.actorId).filter((id): id is string => id !== null))];
  const actors = await prisma.staffUser.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } });
  const actorEmail = new Map(actors.map((actor) => [actor.id, actor.email]));

  return (
    <div>
      <BackLink href="/admin/packages" label="All packages" />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold" data-package-heading>
          {pkg.recipientName}
        </h1>
        <PackageStageBadge stage={pkg.stage} />
        <span className="text-sm text-stone-500">
          {CHANNEL_LABELS[pkg.channel]} · {pkg.fulfillmentMethod.label}
          {pkg.deliveryDay ? ` · ${pkg.deliveryDay}` : ""}
        </span>
      </div>
      <p className="mt-1 text-sm text-stone-500">
        Order{" "}
        <Link href={`/admin/orders/${pkg.orderId}`} className="text-brand-700 hover:underline">
          {orderRef}
        </Link>
        {pkg.recipientAddress && (
          <>
            {" "}
            · {pkg.recipientAddress.line1}
            {pkg.recipientAddress.line2 ? `, ${pkg.recipientAddress.line2}` : ""}, {pkg.recipientAddress.city},{" "}
            {pkg.recipientAddress.region} {pkg.recipientAddress.postalCode}
          </>
        )}
        {pkg.greeting && <> · greeting card</>}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <CardTitle>Contents</CardTitle>
          <ul className="mt-3 flex flex-col gap-2 text-sm" data-package-lines>
            {pkg.lines.map((line) => (
              <li key={line.id} className="flex justify-between gap-4">
                <span>
                  {line.qty} × {line.orderLine.productName}
                  {line.orderLine.optionLabel ? ` (${line.orderLine.optionLabel})` : ""}
                  {line.orderLine.addOnId ? " — add-on" : ""}
                </span>
              </li>
            ))}
            {pkg.lines.length === 0 && <li className="text-stone-500">No lines.</li>}
          </ul>
        </Card>

        <Card className="p-5">
          <CardTitle>Print history</CardTitle>
          <ul className="mt-3 flex flex-col gap-2 text-sm" data-package-batches>
            {pkg.batchItems.map((batchItem) => (
              <li key={batchItem.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {batchItem.batch.filingGroup} — {batchItem.batch.trigger.toLowerCase().replaceAll("_", " ")},{" "}
                  {formatBatchTimestamp(batchItem.batch.createdAt)}
                </span>
                <span className="flex gap-2 text-xs">
                  {(["slips", "labels", "cards"] as const).map((artifact) => (
                    <a
                      key={artifact}
                      href={`/api/admin/fulfillment/print-batches/${batchItem.batch.id}/pdf?artifact=${artifact}`}
                      className="font-medium text-brand-700 hover:underline"
                      data-batch-pdf={artifact}
                    >
                      {artifact}
                    </a>
                  ))}
                </span>
              </li>
            ))}
            {pkg.batchItems.length === 0 && (
              <li className="text-stone-500">Not in any print batch yet — the nightly run will file it.</li>
            )}
          </ul>
        </Card>
      </div>

      <PackageActions
        packageId={pkg.id}
        version={pkg.version}
        stage={pkg.stage}
        nextStages={nextStages as PackageStage[]}
        lines={pkg.lines.map((line) => ({
          orderLineId: line.orderLineId,
          label: `${line.orderLine.productName}${line.orderLine.optionLabel ? ` (${line.orderLine.optionLabel})` : ""}${line.orderLine.addOnId ? " — add-on" : ""}`,
          qty: line.qty,
        }))}
        siblings={siblings.map((sibling) => ({
          id: sibling.id,
          label: `${sibling.recipientName} — ${sibling.stage}, ${sibling._count.lines} line(s)`,
        }))}
      />

      <Card className="mt-6 p-5">
        <CardTitle>Event trail</CardTitle>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm" data-package-events>
          {pkg.events.map((event) => (
            <li key={event.id} className="flex flex-wrap gap-x-3 text-stone-700">
              <span className="text-xs text-stone-500">{formatBatchTimestamp(event.createdAt)}</span>
              <span className="font-medium">{event.action}</span>
              {event.fromStage && event.toStage && (
                <span>
                  {event.fromStage} → {event.toStage}
                </span>
              )}
              <span>{(event.actorId && actorEmail.get(event.actorId)) ?? "system"}</span>
            </li>
          ))}
          {pkg.events.length === 0 && <li className="text-stone-500">No events yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
