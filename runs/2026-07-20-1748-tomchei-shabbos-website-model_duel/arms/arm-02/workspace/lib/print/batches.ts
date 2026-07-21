import type { PackageStage, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ActionError } from "@/lib/packages/actions";
import type { GroupArtifactPayload, PackingSlipPayload, PrintPackage } from "@/lib/print/payload";

// Print batches (UR-005): the nightly run snapshots every not-yet-printed
// package into one artifact per filing group per kind, plus a packing slip per
// order. Filing group = fulfillment method code — that is the physical stack
// the printed paper gets filed under for the parallel print/file workflow.
// Batches only CREATE artifact rows; they never write to Package (G-002).

const packageInclude = {
  fulfillmentMethod: { select: { code: true, name: true } },
  lines: {
    select: {
      quantity: true,
      product: { select: { name: true } },
      addOns: { select: { quantity: true, addOn: { select: { name: true } } } },
      order: { select: { id: true, orderNumber: true, draftReference: true } },
    },
    orderBy: { id: "asc" as const },
  },
} satisfies Prisma.PackageInclude;

type LoadedPackage = Prisma.PackageGetPayload<{ include: typeof packageInclude }>;

const batchInclude = {
  artifacts: { select: { id: true, filingGroup: true, kind: true, orderId: true } },
} satisfies Prisma.PrintBatchInclude;

function orderRef(order: { orderNumber: number | null; draftReference: string }): string {
  return order.orderNumber ? `#${order.orderNumber}` : order.draftReference;
}

/**
 * Snapshot one package for print. `forOrderId` narrows the line list to that
 * order — a packing slip for order X must never show items order Y paid for,
 * even when finalize merged both orders into one physical box (R-056).
 */
function toPrintPackage(entry: LoadedPackage, forOrderId?: string): PrintPackage {
  const lines = forOrderId ? entry.lines.filter((line) => line.order.id === forOrderId) : entry.lines;
  return {
    packageId: entry.id,
    recipientName: entry.recipientName,
    addressLine1: entry.addressLine1,
    addressLine2: entry.addressLine2,
    city: entry.city,
    state: entry.state,
    zip: entry.zip,
    methodName: entry.fulfillmentMethod.name,
    greeting: entry.greeting,
    stage: entry.stage,
    orderRefs: [...new Set(lines.map((line) => orderRef(line.order)))],
    items: lines.map((line) => ({
      name: line.product.name,
      quantity: line.quantity,
      addOns: line.addOns.map((addOn) =>
        addOn.quantity > 1 ? `${addOn.addOn.name} x${addOn.quantity}` : addOn.addOn.name
      ),
    })),
  };
}

async function loadPackages(seasonId: string, where: Prisma.PackageWhereInput): Promise<LoadedPackage[]> {
  return db.package.findMany({
    where: { seasonId, lines: { some: {} }, ...where },
    include: packageInclude,
    orderBy: [{ recipientName: "asc" }, { id: "asc" }],
  });
}

type ArtifactDraft = {
  filingGroup: string;
  kind: "PACKAGE_SLIPS" | "LABELS" | "GREETING_CARDS" | "PACKING_SLIP";
  orderId: string | null;
  payload: GroupArtifactPayload | PackingSlipPayload;
};

/** Card-stock draft for the packages that carry a greeting, or null when none do. */
function greetingCardDraft(
  filingGroup: string,
  packages: LoadedPackage[],
  generatedAt: string,
  orderId: string | null
): ArtifactDraft | null {
  const withGreeting = packages.filter((entry) => entry.greeting.trim() !== "");
  if (withGreeting.length === 0) return null;
  return {
    filingGroup,
    kind: "GREETING_CARDS",
    orderId,
    payload: { filingGroup, generatedAt, packages: withGreeting.map((entry) => toPrintPackage(entry)) },
  };
}

function groupArtifacts(packages: LoadedPackage[], generatedAt: string): ArtifactDraft[] {
  const byGroup = new Map<string, LoadedPackage[]>();
  for (const entry of packages) {
    const group = entry.fulfillmentMethod.code;
    const bucket = byGroup.get(group);
    if (bucket) bucket.push(entry);
    else byGroup.set(group, [entry]);
  }
  const drafts: ArtifactDraft[] = [];
  for (const [filingGroup, groupPackages] of byGroup) {
    const payload: GroupArtifactPayload = {
      filingGroup,
      generatedAt,
      packages: groupPackages.map((entry) => toPrintPackage(entry)),
    };
    drafts.push({ filingGroup, kind: "PACKAGE_SLIPS", orderId: null, payload });
    drafts.push({ filingGroup, kind: "LABELS", orderId: null, payload });
    const cards = greetingCardDraft(filingGroup, groupPackages, generatedAt, null);
    if (cards) drafts.push(cards);
  }
  return drafts;
}

type SlipOrder = {
  id: string;
  orderNumber: number | null;
  draftReference: string;
  customer: { name: string };
};

/** One packing slip per order, each listing ONLY that order's lines (R-056). */
function packingSlipDraft(order: SlipOrder, packages: LoadedPackage[], generatedAt: string): ArtifactDraft {
  const payload: PackingSlipPayload = {
    orderRef: orderRef(order),
    customerName: order.customer.name,
    generatedAt,
    packages: packages.map((entry) => toPrintPackage(entry, order.id)),
  };
  return { filingGroup: `ORDER-${orderRef(order)}`, kind: "PACKING_SLIP", orderId: order.id, payload };
}

async function packingSlipDrafts(packages: LoadedPackage[], generatedAt: string): Promise<ArtifactDraft[]> {
  const byOrder = new Map<string, LoadedPackage[]>();
  for (const entry of packages) {
    for (const orderId of new Set(entry.lines.map((line) => line.order.id))) {
      const bucket = byOrder.get(orderId);
      if (bucket) bucket.push(entry);
      else byOrder.set(orderId, [entry]);
    }
  }
  const orders = await db.order.findMany({
    where: { id: { in: [...byOrder.keys()] } },
    select: { id: true, orderNumber: true, draftReference: true, customer: { select: { name: true } } },
  });
  return orders.map((order) => packingSlipDraft(order, byOrder.get(order.id)!, generatedAt));
}

/**
 * Insert the batch, or — when the unique runKey already exists (double click,
 * two staff racing) — replay the winner instead of throwing. Reprint runKeys
 * are minute-stable, so this doubles as the reprint throttle: hammering the
 * button grows nothing.
 */
async function createOrReplayBatch(
  seasonId: string,
  kind: "NIGHTLY" | "REPRINT_GROUP" | "REPRINT_ORDER",
  runKey: string,
  drafts: ArtifactDraft[],
  actorStaffId?: string
) {
  try {
    const batch = await db.printBatch.create({
      data: {
        seasonId,
        kind,
        runKey,
        createdByStaffId: actorStaffId,
        artifacts: {
          create: drafts.map((draft) => ({
            filingGroup: draft.filingGroup,
            kind: draft.kind,
            orderId: draft.orderId,
            payload: draft.payload as unknown as Prisma.InputJsonValue,
          })),
        },
      },
      include: batchInclude,
    });
    return { batch, replayed: false };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const winner = await db.printBatch.findUniqueOrThrow({ where: { runKey }, include: batchInclude });
      return { batch: winner, replayed: true };
    }
    throw error;
  }
}

/** Minute-granularity window for reprint runKeys: idempotent within it, fresh after it. */
function reprintWindow(): string {
  return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

const NOT_DONE: PackageStage[] = ["NEW", "PRINTED", "PACKED"];

/** Live per-order packing slip payload for the order-detail download (R-056). */
export async function buildOrderPackingSlip(orderId: string): Promise<PackingSlipPayload> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      seasonId: true,
      orderNumber: true,
      draftReference: true,
      customer: { select: { name: true } },
    },
  });
  if (!order) throw new ActionError("Order not found", 404);
  const packages = await loadPackages(order.seasonId, { lines: { some: { orderId } } });
  if (packages.length === 0) throw new ActionError("This order has no packages yet — finalize it first", 409);
  return {
    orderRef: orderRef(order),
    customerName: order.customer.name,
    generatedAt: new Date().toISOString(),
    packages: packages.map((entry) => toPrintPackage(entry, orderId)),
  };
}

/**
 * Nightly run, idempotent per calendar day per season: the unique runKey means
 * the second trigger of the same day gets the morning's batch back untouched.
 * Scope is stage-NEW packages — reprints exist for everything already printed.
 */
export async function runNightlyBatch(seasonId: string, actorStaffId?: string) {
  const runKey = `nightly-${seasonId}-${new Date().toISOString().slice(0, 10)}`;
  const existing = await db.printBatch.findUnique({ where: { runKey }, include: batchInclude });
  if (existing) return { batch: existing, replayed: true };

  const generatedAt = new Date().toISOString();
  const packages = await loadPackages(seasonId, { stage: "NEW" });
  if (packages.length === 0) throw new ActionError("No new packages to print tonight", 404);
  const drafts = [...groupArtifacts(packages, generatedAt), ...(await packingSlipDrafts(packages, generatedAt))];
  return createOrReplayBatch(seasonId, "NIGHTLY", runKey, drafts, actorStaffId);
}

/** Regenerate one filing group's artifacts (any not-yet-done stage) without touching other groups. */
export async function reprintFilingGroup(seasonId: string, filingGroup: string, actorStaffId?: string) {
  const generatedAt = new Date().toISOString();
  const packages = await loadPackages(seasonId, {
    stage: { in: NOT_DONE },
    fulfillmentMethod: { code: filingGroup },
  });
  if (packages.length === 0) throw new ActionError("That filing group has no printable packages", 404);
  const drafts = groupArtifacts(packages, generatedAt);
  return createOrReplayBatch(seasonId, "REPRINT_GROUP", `reprint-group-${filingGroup}-${reprintWindow()}`, drafts, actorStaffId);
}

/** Regenerate one order's paperwork — packing slip plus its packages' labels and cards. */
export async function reprintOrder(seasonId: string, orderId: string, actorStaffId?: string) {
  const generatedAt = new Date().toISOString();
  const packages = await loadPackages(seasonId, { lines: { some: { orderId } } });
  if (packages.length === 0) throw new ActionError("That order has no packages to print", 404);
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { id: true, orderNumber: true, draftReference: true, customer: { select: { name: true } } },
  });
  const group = `ORDER-${orderRef(order)}`;
  const payload: GroupArtifactPayload = {
    filingGroup: group,
    generatedAt,
    packages: packages.map((entry) => toPrintPackage(entry)),
  };
  const cards = greetingCardDraft(group, packages, generatedAt, orderId);
  const drafts: ArtifactDraft[] = [
    { filingGroup: group, kind: "LABELS", orderId, payload },
    ...(cards ? [cards] : []),
    packingSlipDraft(order, packages, generatedAt),
  ];
  return createOrReplayBatch(seasonId, "REPRINT_ORDER", `reprint-order-${orderId}-${reprintWindow()}`, drafts, actorStaffId);
}
