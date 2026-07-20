import { randomUUID } from "node:crypto";
import {
  PrintArtifactKind,
  PrintBatchKind,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

type PrintablePackage = Awaited<ReturnType<typeof loadPrintablePackages>>[number];

async function loadPrintablePackages(
  prisma: PrismaClient | Prisma.TransactionClient,
  where: Prisma.PackageWhereInput = {},
) {
  return prisma.package.findMany({
    where: {
      ...where,
      isActive: true,
      stage: { notIn: ["SENT", "PICKED_UP"] },
      order: { status: "FINALIZED" },
    },
    include: {
      fulfillmentMethod: true,
      lines: {
        include: {
          orderLine: {
            select: {
              productNameSnapshot: true,
              skuSnapshot: true,
            },
          },
        },
      },
      order: {
        select: {
          id: true,
          orderNumber: true,
          customer: { select: { displayName: true } },
        },
      },
    },
    orderBy: [{ fulfillmentMethodId: "asc" }, { orderId: "asc" }, { id: "asc" }],
  });
}

function filingGroup(printablePackage: PrintablePackage) {
  return printablePackage.fulfillmentMethod.code;
}

function artifactPayload(
  kind: PrintArtifactKind,
  group: string,
  packages: PrintablePackage[],
) {
  const headings = {
    SLIPS: `Package slips · ${group}`,
    LABELS: `Recipient labels · ${group}`,
    GREETING_CARDS: `Greeting cards · ${group}`,
    PACKING_SLIP: `Order packing slip`,
  } satisfies Record<PrintArtifactKind, string>;
  return {
    heading: headings[kind],
    filingGroup: group,
    orderIds: [...new Set(packages.map((entry) => entry.orderId))],
    pages: packages.map((entry) => ({
      packageId: entry.id,
      order: `#${entry.order.orderNumber ?? entry.order.id}`,
      customer: entry.order.customer.displayName,
      recipient: entry.recipientName,
      address: entry.addressSnapshot,
      greeting: entry.greetingSnapshot,
      products: entry.lines.map(
        (line) =>
          `${line.quantity} × ${line.orderLine.productNameSnapshot} (${line.orderLine.skuSnapshot})`,
      ),
    })),
  };
}

async function createArtifacts(
  transaction: Prisma.TransactionClient,
  printBatchId: string,
  packages: PrintablePackage[],
  orderId?: string,
) {
  const packagesByGroup = new Map<string, PrintablePackage[]>();
  for (const printablePackage of packages) {
    const group = filingGroup(printablePackage);
    packagesByGroup.set(group, [
      ...(packagesByGroup.get(group) ?? []),
      printablePackage,
    ]);
  }
  for (const [group, groupedPackages] of packagesByGroup) {
    for (const kind of [
      PrintArtifactKind.SLIPS,
      PrintArtifactKind.LABELS,
      PrintArtifactKind.GREETING_CARDS,
    ]) {
      await transaction.printArtifact.create({
        data: {
          printBatchId,
          filingGroup: group,
          kind,
          orderId,
          payload: artifactPayload(kind, group, groupedPackages),
        },
      });
    }
  }

  const packagesByOrder = new Map<string, PrintablePackage[]>();
  for (const printablePackage of packages) {
    packagesByOrder.set(printablePackage.orderId, [
      ...(packagesByOrder.get(printablePackage.orderId) ?? []),
      printablePackage,
    ]);
  }
  for (const [artifactOrderId, orderPackages] of packagesByOrder) {
    await transaction.printArtifact.create({
      data: {
        printBatchId,
        filingGroup: `ORDER-${orderPackages[0]!.order.orderNumber ?? artifactOrderId}`,
        kind: PrintArtifactKind.PACKING_SLIP,
        orderId: artifactOrderId,
        payload: artifactPayload(
          PrintArtifactKind.PACKING_SLIP,
          "ORDER",
          orderPackages,
        ),
      },
    });
  }
}

export async function createNightlyPrintBatch(
  prisma: PrismaClient,
  dateKey: string,
  actorStaffId?: string,
) {
  const runKey = `nightly:${dateKey}`;
  const existing = await prisma.printBatch.findUnique({
    where: { runKey },
    include: { artifacts: true },
  });
  if (existing) return { batch: existing, replayed: true };

  try {
    const batch = await prisma.$transaction(async (transaction) => {
      const createdBatch = await transaction.printBatch.create({
        data: {
          runKey,
          kind: PrintBatchKind.NIGHTLY,
          createdByStaffId: actorStaffId,
        },
      });
      const packages = await loadPrintablePackages(transaction);
      await createArtifacts(transaction, createdBatch.id, packages);
      return transaction.printBatch.findUniqueOrThrow({
        where: { id: createdBatch.id },
        include: { artifacts: true },
      });
    });
    return { batch, replayed: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        batch: await prisma.printBatch.findUniqueOrThrow({
          where: { runKey },
          include: { artifacts: true },
        }),
        replayed: true,
      };
    }
    throw error;
  }
}

export async function reprintFilingGroup(
  prisma: PrismaClient,
  group: string,
  actorStaffId: string,
) {
  const packages = (await loadPrintablePackages(prisma)).filter(
    (entry) => filingGroup(entry) === group,
  );
  if (!packages.length) {
    throw new Error("That filing group has no printable packages.");
  }
  return prisma.$transaction(async (transaction) => {
    const batch = await transaction.printBatch.create({
      data: {
        runKey: `reprint-group:${group}:${randomUUID()}`,
        kind: PrintBatchKind.REPRINT_GROUP,
        createdByStaffId: actorStaffId,
      },
    });
    await createArtifacts(transaction, batch.id, packages);
    return transaction.printBatch.findUniqueOrThrow({
      where: { id: batch.id },
      include: { artifacts: true },
    });
  });
}

export async function reprintOrder(
  prisma: PrismaClient,
  orderId: string,
  actorStaffId: string,
) {
  const packages = await loadPrintablePackages(prisma, { orderId });
  if (!packages.length) {
    throw new Error("That order has no printable packages.");
  }
  return prisma.$transaction(async (transaction) => {
    const batch = await transaction.printBatch.create({
      data: {
        runKey: `reprint-order:${orderId}:${randomUUID()}`,
        kind: PrintBatchKind.REPRINT_ORDER,
        createdByStaffId: actorStaffId,
      },
    });
    await createArtifacts(transaction, batch.id, packages, orderId);
    return transaction.printBatch.findUniqueOrThrow({
      where: { id: batch.id },
      include: { artifacts: true },
    });
  });
}

function escapePdfText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/([\\()])/g, "\\$1");
}

export function renderArtifactPdf(payload: Prisma.JsonValue) {
  const printable = payload as {
    heading: string;
    pages: Array<{
      packageId: string;
      order: string;
      customer: string;
      recipient: string;
      greeting: string;
      products: string[];
    }>;
  };
  const lines = [
    printable.heading,
    ...printable.pages.flatMap((page) => [
      `${page.order} · ${page.recipient}`,
      `Customer: ${page.customer}`,
      ...page.products,
      `Greeting: ${page.greeting}`,
      `Package: ${page.packageId}`,
      "",
    ]),
  ].slice(0, 48);
  const stream = [
    "BT",
    "/F1 11 Tf",
    "50 750 Td",
    ...lines.flatMap((line, index) => [
      index === 0 ? "" : "0 -14 Td",
      `(${escapePdfText(line)}) Tj`,
    ]),
    "ET",
  ]
    .filter(Boolean)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}
