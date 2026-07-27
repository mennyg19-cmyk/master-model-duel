import { PrintArtifactKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatEnumLabel, formatOrderLabel, packageItemCount } from "@/lib/packages";

const PDF_LINES_PER_PAGE = 55;

export async function createNightlyPrintBatch(actorId: string, date = new Date()) {
  const batchKey = date.toISOString().slice(0, 10);
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.printBatch.findUnique({ where: { batchKey }, include: { artifacts: true } });
    if (existing) return { batch: existing, created: false };

    const packages = await transaction.package.findMany({
      where: { isActive: true, status: { in: ["NEW", "PRINTED", "PACKED"] } },
      include: { fulfillmentMethod: true },
      orderBy: [{ fulfillmentMethod: { code: "asc" } }, { recipientName: "asc" }],
    });
    const groups = new Map<string, string[]>();
    for (const packageRecord of packages) {
      const group = groups.get(packageRecord.fulfillmentMethod.code) ?? [];
      group.push(packageRecord.id);
      groups.set(packageRecord.fulfillmentMethod.code, group);
    }
    const batch = await transaction.printBatch.create({ data: { batchKey } });
    const artifacts = [];
    for (const [filingGroup, ids] of groups) {
      for (const kind of ["PACKING_SLIP", "LABEL", "GREETING_CARD"] as PrintArtifactKind[]) {
        artifacts.push(await transaction.printArtifact.create({
          data: { batchId: batch.id, filingGroup, kind, packageIds: ids },
        }));
      }
    }
    await transaction.auditEvent.create({
      data: { actorId, action: "print.batch_created", subjectId: batch.id, details: { batchKey, artifactCount: artifacts.length } },
    });
    return { batch: { ...batch, artifacts }, created: true };
  });
}

export async function reprintArtifact(artifactId: string, actorId: string) {
  const artifact = await prisma.printArtifact.findUnique({ where: { id: artifactId } });
  if (!artifact) throw new Error("Print artifact was not found.");
  await prisma.auditEvent.create({
    data: { actorId, action: "print.artifact_reprinted", subjectId: artifact.id, details: { batchId: artifact.batchId, filingGroup: artifact.filingGroup, kind: artifact.kind } },
  });
  return artifact;
}

export async function reprintOrderPackingSlip(orderId: string, actorId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, status: "FINALIZED" }, select: { id: true } });
  if (!order) throw new Error("Order was not found.");
  await prisma.auditEvent.create({
    data: { actorId, action: "print.order_packing_slip_reprinted", subjectId: order.id, details: {} },
  });
  return order;
}

type PrintDocument = { title: string; lines: string[] };

type PrintablePackage = {
  recipientName: string;
  greeting: string;
  order: { orderNumber: number | null; draftReference: string };
  address: { line1: string; line2: string | null; city: string; state: string; postalCode: string } | null;
  fulfillmentMethod: { name: string };
  lines: Array<{ quantity: number; orderLine: { productNameSnapshot: string } }>;
};

function formatPackageLines(packageRecord: PrintablePackage, kind: PrintArtifactKind, includeOrder: boolean) {
  const orderLine = includeOrder ? [`Order ${formatOrderLabel(packageRecord.order)}`] : [];
  if (kind === "LABEL") {
    const addressLines = packageRecord.address
      ? [packageRecord.address.line1, packageRecord.address.line2, `${packageRecord.address.city}, ${packageRecord.address.state} ${packageRecord.address.postalCode}`].filter((line): line is string => Boolean(line))
      : ["Address unavailable"];
    return [...orderLine, "SHIP TO", packageRecord.recipientName, ...addressLines, packageRecord.fulfillmentMethod.name];
  }
  if (kind === "GREETING_CARD") {
    return [`To ${packageRecord.recipientName}`, packageRecord.greeting || "Warm wishes", `Delivery: ${packageRecord.fulfillmentMethod.name}`];
  }
  return [
    ...orderLine,
    `${packageRecord.recipientName} · ${packageRecord.fulfillmentMethod.name}`,
    ...packageRecord.lines.map((line) => `${line.quantity} × ${line.orderLine.productNameSnapshot}`),
    `${packageItemCount(packageRecord.lines)} item(s) · ${packageRecord.greeting}`,
  ];
}

export async function printArtifactDocument(artifactId: string): Promise<PrintDocument> {
  const artifact = await prisma.printArtifact.findUniqueOrThrow({ where: { id: artifactId } });
  const artifactPackageIds = Array.isArray(artifact.packageIds) && artifact.packageIds.every((id): id is string => typeof id === "string")
    ? artifact.packageIds
    : [];
  const packages = await prisma.package.findMany({
    where: { id: { in: artifactPackageIds }, isActive: true, order: { status: "FINALIZED" } },
    include: { order: true, address: true, fulfillmentMethod: true, lines: { include: { orderLine: true } } },
    orderBy: { recipientName: "asc" },
  });
  if (!packages.length) throw new Error("This print artifact has no printable finalized packages.");
  const title = `${formatEnumLabel(artifact.kind)} · ${formatEnumLabel(artifact.filingGroup)}`;
  return {
    title,
    lines: packages.flatMap((packageRecord) => formatPackageLines(packageRecord, artifact.kind, true)),
  };
}

export async function orderPackingSlipDocument(orderId: string): Promise<PrintDocument> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, status: "FINALIZED" },
    include: {
      packages: {
        where: { isActive: true },
        include: { order: true, address: true, fulfillmentMethod: true, lines: { include: { orderLine: true } } },
      },
    },
  });
  if (!order) throw new Error("Order was not found.");
  return {
    title: `Packing slip · order ${formatOrderLabel(order)}`,
    lines: order.packages.flatMap((packageRecord) => formatPackageLines(packageRecord, "PACKING_SLIP", false)),
  };
}

export function createPdf(document: PrintDocument) {
  const pdfText = (text: string) => text
    .replace(/[^\x20-\x7E]/g, " ")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
  const content = [
    "BT",
    "/F1 16 Tf",
    "72 760 Td",
    `(${pdfText(document.title)}) Tj`,
    "/F1 10 Tf",
    ...document.lines.slice(0, PDF_LINES_PER_PAGE).flatMap((line) => ["0 -16 Td", `(${pdfText(line)}) Tj`]),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const startXref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}
