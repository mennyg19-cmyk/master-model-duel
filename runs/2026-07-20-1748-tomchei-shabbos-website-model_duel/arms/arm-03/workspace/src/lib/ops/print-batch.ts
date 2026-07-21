import { createHash } from "node:crypto";
import {
  AuditAction,
  PrintArtifactKind,
  PrintBatchKind,
  type Package,
  type PackageStage,
} from "@prisma/client";
import { db } from "@/lib/db";
import { err, maskError, ok, type Result } from "@/lib/result";
import {
  CARD_5X7,
  LABEL_4X6,
  LETTER,
  paginate,
  renderPdf,
  type PdfLine,
  type PdfPageSize,
} from "@/lib/pdf";

export function filingGroupForMethodCode(code: string): string {
  return code.trim().toUpperCase() || "UNKNOWN";
}

function calendarDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function nightlyRunKey(seasonId: string, day = calendarDayKey()): string {
  return `nightly:${seasonId}:${day}`;
}

function packageFingerprint(
  packages: Array<{ id: string; stage: string }>,
): string {
  const raw = packages
    .map((pkg) => `${pkg.id}:${pkg.stage}`)
    .sort()
    .join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 12);
}

export function reprintGroupRunKey(
  seasonId: string,
  filingGroup: string,
  fingerprint: string,
): string {
  return `reprint-group:${seasonId}:${filingGroup}:${fingerprint}`;
}

export function reprintOrderRunKey(orderId: string, fingerprint: string): string {
  return `reprint-order:${orderId}:${fingerprint}`;
}

type PackageRow = Package & {
  fulfillmentMethod: { code: string; label: string };
  order: {
    id: string;
    orderNumber: number | null;
    draftRef: string;
    seasonId: string;
  };
  items: Array<{
    quantity: number;
    orderLine: { product: { name: string; sku: string } };
  }>;
};

function packageLoadInclude() {
  return {
    fulfillmentMethod: { select: { code: true, label: true } },
    order: {
      select: {
        id: true,
        orderNumber: true,
        draftRef: true,
        seasonId: true,
      },
    },
    items: {
      include: {
        orderLine: {
          select: { product: { select: { name: true, sku: true } } },
        },
      },
    },
  } as const;
}

function slipLines(pkg: PackageRow): string[] {
  return [
    `PACKAGE SLIP - ${pkg.fulfillmentMethod.code}`,
    `Order #${pkg.order.orderNumber ?? pkg.order.draftRef}`,
    `Package ${pkg.id}`,
    `Stage: ${pkg.stage} (print does not change stage)`,
    `To: ${pkg.recipientName}`,
    `${pkg.addressLine1}${pkg.addressLine2 ? `, ${pkg.addressLine2}` : ""}`,
    `${pkg.city}, ${pkg.state} ${pkg.postalCode}`,
    `Greeting: ${pkg.greeting || "(none)"}`,
    "- Items -",
    ...pkg.items.map(
      (row) => `${row.quantity}x ${row.orderLine.product.name} (${row.orderLine.product.sku})`,
    ),
  ];
}

function labelLines(pkg: PackageRow): string[] {
  return [
    "SHIPPING / PICKUP LABEL",
    pkg.recipientName,
    pkg.addressLine1,
    `${pkg.city}, ${pkg.state} ${pkg.postalCode}`,
    `Method: ${pkg.fulfillmentMethod.label}`,
    `Order #${pkg.order.orderNumber ?? pkg.order.draftRef}`,
  ];
}

function cardLines(pkg: PackageRow): string[] {
  return [
    "GREETING CARD - card stock",
    pkg.greeting || "Season's greetings",
    "",
    `For: ${pkg.recipientName}`,
    `Order #${pkg.order.orderNumber ?? pkg.order.draftRef}`,
  ];
}

function packingSlipLines(orderNumber: string | number, packages: PackageRow[]): string[] {
  const lines = [
    "PER-ORDER PACKING SLIP",
    `Order #${orderNumber}`,
    `Packages: ${packages.length}`,
    "",
  ];
  for (const pkg of packages) {
    lines.push(`* ${pkg.recipientName} - ${pkg.fulfillmentMethod.code} - ${pkg.stage}`);
    for (const row of pkg.items) {
      lines.push(`    ${row.quantity}x ${row.orderLine.product.name}`);
    }
  }
  return lines;
}

function toPdfLines(lines: string[]): PdfLine[] {
  return lines.map((text, index) => ({
    text,
    size: 11,
    gapBefore: index === 0 ? 0 : 2,
  }));
}

function pdfForKind(kind: PrintArtifactKind, lines: string[]): Buffer {
  let size: PdfPageSize = LETTER;
  if (kind === PrintArtifactKind.LABELS) size = LABEL_4X6;
  if (kind === PrintArtifactKind.GREETING_CARDS) size = CARD_5X7;
  return renderPdf(paginate(toPdfLines(lines), size), size);
}

function pdfToDataUrl(pdf: Buffer): string {
  return `data:application/pdf;base64,${pdf.toString("base64")}`;
}

type ArtifactSpec = {
  filingGroup: string;
  kind: PrintArtifactKind;
  orderId: string | null;
  title: string;
  lines: string[];
  packageIds: string[];
  stagesSnapshot: Array<{ packageId: string; stage: PackageStage }>;
};

function buildGroupArtifacts(packages: PackageRow[]): ArtifactSpec[] {
  const byGroup = new Map<string, PackageRow[]>();
  for (const pkg of packages) {
    const group = filingGroupForMethodCode(pkg.fulfillmentMethod.code);
    const list = byGroup.get(group) ?? [];
    list.push(pkg);
    byGroup.set(group, list);
  }

  const specs: ArtifactSpec[] = [];
  for (const [filingGroup, groupPkgs] of byGroup) {
    const stagesSnapshot = groupPkgs.map((p) => ({
      packageId: p.id,
      stage: p.stage,
    }));
    const packageIds = groupPkgs.map((p) => p.id);

    const slipBody = groupPkgs.flatMap((p, idx) => [
      ...(idx > 0 ? ["", "----------", ""] : []),
      ...slipLines(p),
    ]);
    specs.push({
      filingGroup,
      kind: PrintArtifactKind.PACKAGE_SLIPS,
      orderId: null,
      title: `Slips - ${filingGroup}`,
      lines: slipBody,
      packageIds,
      stagesSnapshot,
    });

    const labelBody = groupPkgs.flatMap((p, idx) => [
      ...(idx > 0 ? ["", "----------", ""] : []),
      ...labelLines(p),
    ]);
    specs.push({
      filingGroup,
      kind: PrintArtifactKind.LABELS,
      orderId: null,
      title: `Labels - ${filingGroup}`,
      lines: labelBody,
      packageIds,
      stagesSnapshot,
    });

    const cardBody = groupPkgs.flatMap((p, idx) => [
      ...(idx > 0 ? ["", "----------", ""] : []),
      ...cardLines(p),
    ]);
    specs.push({
      filingGroup,
      kind: PrintArtifactKind.GREETING_CARDS,
      orderId: null,
      title: `Greeting cards - ${filingGroup}`,
      lines: cardBody,
      packageIds,
      stagesSnapshot,
    });
  }

  const byOrder = new Map<string, PackageRow[]>();
  for (const pkg of packages) {
    const list = byOrder.get(pkg.orderId) ?? [];
    list.push(pkg);
    byOrder.set(pkg.orderId, list);
  }
  for (const [orderId, orderPkgs] of byOrder) {
    const head = orderPkgs[0]!;
    specs.push({
      filingGroup: "ORDER",
      kind: PrintArtifactKind.PACKING_SLIP,
      orderId,
      title: `Packing slip - order ${head.order.orderNumber ?? head.order.draftRef}`,
      lines: packingSlipLines(head.order.orderNumber ?? head.order.draftRef, orderPkgs),
      packageIds: orderPkgs.map((p) => p.id),
      stagesSnapshot: orderPkgs.map((p) => ({ packageId: p.id, stage: p.stage })),
    });
  }

  return specs;
}

async function measureStagesUnchanged(
  packages: Array<{ id: string; stage: PackageStage }>,
): Promise<boolean> {
  if (packages.length === 0) return true;
  const current = await db.package.findMany({
    where: { id: { in: packages.map((p) => p.id) } },
    select: { id: true, stage: true },
  });
  const byId = new Map(current.map((row) => [row.id, row.stage]));
  return packages.every((pkg) => byId.get(pkg.id) === pkg.stage);
}

async function persistBatch(input: {
  seasonId: string;
  kind: PrintBatchKind;
  runKey: string;
  packages: PackageRow[];
  actorId?: string | null;
  /** When true, return existing batch without regenerating. */
  idempotent: boolean;
}) {
  if (input.idempotent) {
    const existing = await db.printBatch.findUnique({
      where: { runKey: input.runKey },
      include: { artifacts: true },
    });
    if (existing) {
      const stagesUnchanged = await measureStagesUnchanged(input.packages);
      return { batch: existing, created: false as const, stagesUnchanged };
    }
  }

  const specs = buildGroupArtifacts(input.packages);
  // Generate PDFs outside the DB transaction (avoid holding locks during encode).
  const artifactCreates = specs.map((spec) => {
    const pdf = pdfForKind(spec.kind, spec.lines);
    return {
      filingGroup: spec.filingGroup,
      kind: spec.kind,
      orderId: spec.orderId,
      payload: {
        title: spec.title,
        lines: spec.lines,
        packageIds: spec.packageIds,
        stagesSnapshot: spec.stagesSnapshot,
        pdfDataUrl: pdfToDataUrl(pdf),
        stock: spec.kind === PrintArtifactKind.GREETING_CARDS ? "card" : "plain",
        pageSize:
          spec.kind === PrintArtifactKind.LABELS
            ? "4x6"
            : spec.kind === PrintArtifactKind.GREETING_CARDS
              ? "5x7"
              : "letter",
      },
    };
  });

  const batch = await db.$transaction(async (tx) => {
    const created = await tx.printBatch.create({
      data: {
        seasonId: input.seasonId,
        kind: input.kind,
        runKey: input.runKey,
        createdByStaffId: input.actorId ?? null,
        artifacts: { create: artifactCreates },
      },
      include: { artifacts: true },
    });

    await tx.auditLog.create({
      data: {
        action: AuditAction.PRINT_BATCH_CREATED,
        actorId: input.actorId ?? null,
        meta: {
          printBatchId: created.id,
          kind: input.kind,
          runKey: input.runKey,
          artifactCount: created.artifacts.length,
          packageCount: input.packages.length,
          stagesMutated: false,
        },
      },
    });

    return created;
  });

  const stagesUnchanged = await measureStagesUnchanged(input.packages);
  return { batch, created: true as const, stagesUnchanged };
}

export async function runNightlyPrintBatch(input: {
  seasonId: string;
  actorId?: string | null;
  day?: string;
}): Promise<
  Result<{
    batchId: string;
    runKey: string;
    created: boolean;
    artifactCount: number;
    packageCount: number;
    stagesUnchanged: boolean;
    packageStages: Array<{ id: string; stage: PackageStage; orderId: string }>;
  }>
> {
  try {
    const runKey = nightlyRunKey(input.seasonId, input.day);
    // Only NEW (tonight's unbatched) — not already-printed/packed backlog.
    const packages = (await db.package.findMany({
      where: {
        order: { seasonId: input.seasonId },
        stage: "NEW",
      },
      include: packageLoadInclude(),
      orderBy: [{ createdAt: "asc" }],
    })) as PackageRow[];

    const outcome = await persistBatch({
      seasonId: input.seasonId,
      kind: PrintBatchKind.NIGHTLY,
      runKey,
      packages,
      actorId: input.actorId,
      idempotent: true,
    });

    const packageStages =
      packages.length <= 200 ? await packageStagesForBatch(outcome.batch.id) : [];

    return ok({
      batchId: outcome.batch.id,
      runKey: outcome.batch.runKey,
      created: outcome.created,
      artifactCount: outcome.batch.artifacts.length,
      packageCount: packages.length,
      stagesUnchanged: outcome.stagesUnchanged,
      packageStages,
    });
  } catch (error) {
    return err(maskError(error), "Could not run nightly print batch.");
  }
}

export async function reprintFilingGroup(input: {
  seasonId: string;
  filingGroup: string;
  actorId?: string | null;
}): Promise<
  Result<{
    batchId: string;
    runKey: string;
    created: boolean;
    artifactCount: number;
    packageCount: number;
    stagesUnchanged: boolean;
    packageStages: Array<{ id: string; stage: PackageStage; orderId: string }>;
  }>
> {
  try {
    const group = filingGroupForMethodCode(input.filingGroup);
    const packages = (await db.package.findMany({
      where: {
        order: { seasonId: input.seasonId },
        fulfillmentMethod: { code: { equals: group, mode: "insensitive" } },
      },
      include: packageLoadInclude(),
      orderBy: [{ createdAt: "asc" }],
    })) as PackageRow[];

    if (packages.length === 0) {
      throw new Error(`No packages in filing group ${group}`);
    }

    const fingerprint = packageFingerprint(packages);
    const runKey = reprintGroupRunKey(input.seasonId, group, fingerprint);
    const outcome = await persistBatch({
      seasonId: input.seasonId,
      kind: PrintBatchKind.REPRINT_GROUP,
      runKey,
      packages,
      actorId: input.actorId,
      idempotent: true,
    });

    const packageStages = await packageStagesForBatch(outcome.batch.id);

    return ok({
      batchId: outcome.batch.id,
      runKey: outcome.batch.runKey,
      created: outcome.created,
      artifactCount: outcome.batch.artifacts.length,
      packageCount: packages.length,
      stagesUnchanged: outcome.stagesUnchanged,
      packageStages,
    });
  } catch (error) {
    return err(maskError(error), "Could not reprint filing group.");
  }
}

export async function reprintOrder(input: {
  seasonId: string;
  orderId: string;
  actorId?: string | null;
}): Promise<
  Result<{
    batchId: string;
    runKey: string;
    created: boolean;
    artifactCount: number;
    packageCount: number;
    stagesUnchanged: boolean;
    packageStages: Array<{ id: string; stage: PackageStage; orderId: string }>;
  }>
> {
  try {
    const order = await db.order.findFirst({
      where: { id: input.orderId, seasonId: input.seasonId },
    });
    if (!order) throw new Error(`Order ${input.orderId} not found in season`);

    const packages = (await db.package.findMany({
      where: { orderId: input.orderId, order: { seasonId: input.seasonId } },
      include: packageLoadInclude(),
      orderBy: [{ createdAt: "asc" }],
    })) as PackageRow[];

    if (packages.length === 0) {
      throw new Error(`Order ${input.orderId} has no packages`);
    }

    const fingerprint = packageFingerprint(packages);
    const runKey = reprintOrderRunKey(input.orderId, fingerprint);
    const outcome = await persistBatch({
      seasonId: order.seasonId,
      kind: PrintBatchKind.REPRINT_ORDER,
      runKey,
      packages,
      actorId: input.actorId,
      idempotent: true,
    });

    const packageStages = await packageStagesForBatch(outcome.batch.id);

    return ok({
      batchId: outcome.batch.id,
      runKey: outcome.batch.runKey,
      created: outcome.created,
      artifactCount: outcome.batch.artifacts.length,
      packageCount: packages.length,
      stagesUnchanged: outcome.stagesUnchanged,
      packageStages,
    });
  } catch (error) {
    return err(maskError(error), "Could not reprint order.");
  }
}

export async function listPrintBatches(seasonId: string, limit = 20) {
  return db.printBatch.findMany({
    where: { seasonId },
    orderBy: { createdAt: "desc" },
    take: Math.min(50, Math.max(1, limit)),
    include: {
      season: { select: { id: true, name: true, year: true } },
      _count: { select: { artifacts: true } },
      artifacts: {
        select: {
          id: true,
          filingGroup: true,
          kind: true,
          orderId: true,
          createdAt: true,
        },
        orderBy: [{ filingGroup: "asc" }, { kind: "asc" }],
      },
    },
  });
}

export async function getPrintArtifact(seasonId: string, artifactId: string) {
  return db.printArtifact.findFirst({
    where: { id: artifactId, printBatch: { seasonId } },
    include: { printBatch: true },
  });
}

/** Snapshot stages for packages referenced by a batch — proves print ≠ ship. */
export async function packageStagesForBatch(batchId: string) {
  const artifacts = await db.printArtifact.findMany({
    where: { printBatchId: batchId },
    select: { payload: true },
  });
  const ids = new Set<string>();
  for (const art of artifacts) {
    const payload = art.payload as { packageIds?: string[] };
    for (const id of payload.packageIds ?? []) ids.add(id);
  }
  if (ids.size === 0) return [];
  return db.package.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, stage: true, orderId: true },
  });
}
