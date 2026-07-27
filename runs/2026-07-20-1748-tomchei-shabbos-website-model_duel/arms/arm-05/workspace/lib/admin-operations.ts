import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createPosOrder } from "@/lib/checkout";

const importRowSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(7).max(20).optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  sku: z.string().trim().min(1).max(80).optional(),
  productName: z.string().trim().min(1).max(120).optional(),
  priceCents: z.number().int().min(0).max(100_000).optional(),
});

type ImportRow = z.infer<typeof importRowSchema>;
type StagedImport = {
  actorId: string;
  kind: "customers" | "products";
  rows: ImportRow[];
  errors: string[];
  createdAt: string;
};

function importKey(batchId: string) {
  return `import.batch:${batchId}`;
}

function normalizeEmail(email: string | undefined) {
  return email?.trim().toLowerCase();
}

export function parseCsv(csv: string, kind: "customers" | "products") {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  const [headerLine, ...body] = lines;
  if (!headerLine || body.length === 0) throw new Error("CSV needs a header and at least one row.");
  const headers = headerLine.split(",").map((column) => column.trim());
  const rows: ImportRow[] = [];
  const errors: string[] = [];
  body.forEach((line, index) => {
    const values = line.split(",").map((value) => value.trim());
    const candidate = Object.fromEntries(headers.map((header, column) => [header, values[column] || undefined]));
    const parsed = importRowSchema.safeParse({
      ...candidate,
      priceCents: candidate.priceCents ? Number(candidate.priceCents) : undefined,
    });
    if (!parsed.success || (kind === "products" && (!parsed.data.sku || !parsed.data.productName || parsed.data.priceCents === undefined))) {
      errors.push(`Row ${index + 2}: invalid ${kind === "products" ? "SKU, product name, or price" : "customer contact"}.`);
      return;
    }
    if (kind === "customers" && !parsed.data.email && !parsed.data.phone) {
      errors.push(`Row ${index + 2}: a customer needs an email or phone.`);
      return;
    }
    rows.push(parsed.data);
  });
  return { rows, errors };
}

export async function stageImport(csv: string, kind: "customers" | "products", actorId: string) {
  const parsed = parseCsv(csv, kind);
  if (kind === "customers") {
    const contacts = parsed.rows.map((row) => normalizeEmail(row.email) ?? row.phone?.replace(/\D/g, "")).filter((contact): contact is string => Boolean(contact));
    const duplicates = contacts.filter((contact, index) => contacts.indexOf(contact) !== index);
    const existing = contacts.length ? await prisma.customer.findMany({
      where: { OR: contacts.flatMap((contact) => [{ emailNormalized: contact }, { phoneNormalized: contact }]) },
      select: { emailNormalized: true, phoneNormalized: true },
    }) : [];
    parsed.errors.push(...[...new Set(duplicates)].map((contact) => `Duplicate CSV contact ${contact}.`));
    parsed.errors.push(...existing.map((customer) => `Existing customer ${customer.emailNormalized ?? customer.phoneNormalized}.`));
  }
  const batchId = randomUUID();
  const staged: StagedImport = { actorId, kind, ...parsed, createdAt: new Date().toISOString() };
  await prisma.$transaction([
    prisma.appSetting.create({ data: { key: importKey(batchId), value: staged } }),
    prisma.auditEvent.create({ data: { actorId, action: "import.staged", subjectId: batchId, details: { kind, accepted: parsed.rows.length, rejected: parsed.errors.length } } }),
  ]);
  return { batchId, accepted: parsed.rows.length, errors: parsed.errors };
}

async function readStagedImport(batchId: string) {
  const setting = await prisma.appSetting.findUnique({ where: { key: importKey(batchId) } });
  const staged = setting?.value as Partial<StagedImport> | null;
  if (!staged || !Array.isArray(staged.rows) || (staged.kind !== "customers" && staged.kind !== "products") || !staged.actorId) {
    throw new Error("Import batch was not found.");
  }
  return staged as StagedImport;
}

export async function getStagedImportKind(batchId: string) {
  return (await readStagedImport(batchId)).kind;
}

export async function commitImport(batchId: string, actorId: string) {
  const staged = await readStagedImport(batchId);
  if (staged.actorId !== actorId) throw new Error("Only the staff member who staged this import can commit it.");
  const rows = staged.rows;
  if (staged.errors?.length) throw new Error("Correct invalid rows before committing this import.");

  await prisma.$transaction(async (transaction) => {
    if (staged.kind === "customers") {
      for (const customer of rows) {
        const emailNormalized = normalizeEmail(customer.email);
        const phoneNormalized = customer.phone?.replace(/\D/g, "");
        const existing = await transaction.customer.findFirst({ where: { OR: [{ emailNormalized }, { phoneNormalized }] } });
        if (existing) throw new Error(`Duplicate customer ${emailNormalized ?? phoneNormalized}.`);
        await transaction.customer.create({ data: { firstName: customer.firstName, lastName: customer.lastName, emailNormalized, phoneNormalized } });
      }
    } else {
      const season = await transaction.season.findFirst({ where: { status: "OPEN" }, orderBy: { year: "desc" } });
      if (!season) throw new Error("Open a season before importing products.");
      for (const product of rows) {
        const existing = await transaction.product.findUnique({
          where: { seasonId_sku: { seasonId: season.id, sku: product.sku! } },
          select: { id: true },
        });
        if (existing) throw new Error(`Duplicate product SKU ${product.sku}.`);
        await transaction.product.create({
          data: { seasonId: season.id, sku: product.sku!, name: product.productName!, priceCents: product.priceCents!, kind: "PACKAGE" },
        });
      }
    }
    await transaction.appSetting.delete({ where: { key: importKey(batchId) } });
    await transaction.auditEvent.create({ data: { actorId, action: "import.committed", subjectId: batchId, details: { kind: staged.kind, rows: rows.length } } });
  });
  return { imported: rows.length, kind: staged.kind };
}

export async function listOrders({ query, status, page }: { query?: string; status?: string; page: number }) {
  const take = 25;
  const where = {
    ...(status ? { status: status as "DRAFT" | "FINALIZED" | "DISCARDED" } : {}),
    ...(query ? { OR: [{ draftReference: { contains: query, mode: "insensitive" as const } }, { customer: { is: { emailNormalized: { contains: query, mode: "insensitive" as const } } } }] } : {}),
  };
  const [total, orders] = await prisma.$transaction([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, take, skip: (page - 1) * take, orderBy: { updatedAt: "desc" }, include: { customer: true, payments: true } }),
  ]);
  return { total, page, pageSize: take, orders };
}

export async function listCustomers(query: string | undefined, page: number) {
  const take = 25;
  const where = query ? { OR: [
    { firstName: { contains: query, mode: "insensitive" as const } },
    { lastName: { contains: query, mode: "insensitive" as const } },
    { emailNormalized: { contains: query, mode: "insensitive" as const } },
  ] } : {};
  const [total, customers] = await prisma.$transaction([
    prisma.customer.count({ where }),
    prisma.customer.findMany({ where, take, skip: (page - 1) * take, orderBy: { updatedAt: "desc" }, include: { _count: { select: { orders: true } } } }),
  ]);
  return { total, page, pageSize: take, customers };
}

export async function operationsDashboard() {
  const [recentOrders, todayCount, orderCount, paidTotal] = await Promise.all([
    prisma.order.findMany({ where: { status: "FINALIZED" }, take: 5, orderBy: { updatedAt: "desc" }, include: { customer: true } }),
    prisma.order.count({ where: { status: "DRAFT", updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
    prisma.order.count(),
    prisma.payment.aggregate({ where: { status: "POSTED" }, _sum: { amountCents: true } }),
  ]);
  return { recentOrders, todayCount, orderCount, paidCents: paidTotal._sum.amountCents ?? 0 };
}

export async function createWalkInPosOrder(input: unknown, actorId: string, requestUrl: string, canUpdateCustomer = true) {
  const parsed = z.object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().email().optional(),
    productId: z.string().cuid(),
    quantity: z.number().int().min(1).max(100),
    method: z.enum(["CASH", "CHECK"]),
  }).parse(input);
  const product = await prisma.product.findUniqueOrThrow({ where: { id: parsed.productId }, include: { inventoryItems: true } });
  if (!product.isActive) throw new Error("This product is no longer available.");
  const emailNormalized = normalizeEmail(parsed.email);
  const customer = emailNormalized
    ? await prisma.customer.upsert({
      where: { emailNormalized },
      create: { firstName: parsed.firstName, lastName: parsed.lastName, emailNormalized },
      update: canUpdateCustomer ? { firstName: parsed.firstName, lastName: parsed.lastName } : {},
    })
    : await prisma.customer.create({
      data: { firstName: parsed.firstName, lastName: parsed.lastName },
    });
  const address = await prisma.address.create({
    data: { customerId: customer.id, recipientName: `${customer.firstName} ${customer.lastName}`, line1: "Walk-in pickup", city: "Brooklyn", state: "NY", postalCode: "11201", normalizedAddress: `walkin|${randomUUID()}` },
  });
  const order = await prisma.order.create({
    data: {
      seasonId: product.seasonId, customerId: customer.id, draftReference: `POS-${randomUUID().slice(0, 8)}`, subtotalCents: product.priceCents * parsed.quantity, totalCents: product.priceCents * parsed.quantity,
      wireFormat: { version: 1, source: "POS" },
      lines: { create: { productId: product.id, quantity: parsed.quantity, productNameSnapshot: product.name, skuSnapshot: product.sku, unitPriceCents: product.priceCents } },
    },
  });
  return createPosOrder(order.id, { donationCents: 0, recipients: [{ addressId: address.id, method: "PICKUP", greeting: "Walk-in order" }] }, parsed.method, actorId, requestUrl);
}
