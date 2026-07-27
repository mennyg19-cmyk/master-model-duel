import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { normalizeAddress, normalizeEmail, normalizePhone } from "@/lib/foundation";

type LegacyRow = Record<string, string>;
type LegacyStage = { actorId: string; rows: LegacyRow[]; errors: string[]; createdAt: string };
type CsvDataset = "year_metrics" | "shipping_margin" | "item_sales";

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function parseCsvRecords(csv: string) {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted && character === "\"" && csv[index + 1] === "\"") {
      cell += "\"";
      index += 1;
    } else if (character === "\"") {
      quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some(Boolean)) records.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) return { records, errors: ["CSV has an unclosed quoted field."] };
  row.push(cell);
  if (row.some(Boolean)) records.push(row);
  return { records, errors: [] as string[] };
}

function parseCsv(csv: string) {
  const parsed = parseCsvRecords(csv);
  if (parsed.records.length < 2) return { rows: [] as LegacyRow[], errors: [...parsed.errors, "Provide a header and at least one row."] };
  const [header, ...records] = parsed.records;
  const headers = header.map((column) => column.trim().toLowerCase());
  const errors: string[] = [];
  const rows = records.map((values, index) => {
    if (values.length > headers.length) errors.push(`Row ${index + 2} has ${values.length} columns; expected at most ${headers.length}.`);
    return Object.fromEntries(headers.map((header, column) => [header, values[column]?.trim() ?? ""]));
  });
  return { rows, errors: [...parsed.errors, ...errors] };
}

function legacyEmail(email: string) {
  return normalizeEmail(email) || undefined;
}

function legacyAddress(row: LegacyRow) {
  return normalizeAddress({
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
  });
}

function validateLegacyRows(rows: LegacyRow[]) {
  const errors: string[] = [];
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (!["customer", "product", "order"].includes(row.kind)) errors.push(`Row ${rowNumber} needs kind customer, product, or order.`);
    if (row.kind === "customer" && (!row.first_name || !row.last_name || !legacyEmail(row.email))) errors.push(`Customer row ${rowNumber} needs first_name, last_name, and email.`);
    if (row.kind === "product" && (!row.year || !row.sku || !row.product_name || !Number.isInteger(Number(row.price_cents)))) errors.push(`Product row ${rowNumber} needs year, sku, product_name, and integer price_cents.`);
    if (row.kind === "order" && (!row.year || !legacyEmail(row.email) || !row.sku || !Number.isInteger(Number(row.total_cents)))) errors.push(`Order row ${rowNumber} needs year, email, sku, and integer total_cents.`);
    if (row.kind === "order" && [row.line1, row.city, row.state, row.postal_code].some((value) => !value?.trim())) {
      errors.push(`Order row ${rowNumber} needs line1, city, state, and postal_code for address review.`);
    }
  });
  return errors;
}

async function validateLegacyReferences(rows: LegacyRow[]) {
  const errors: string[] = [];
  const customerRows = rows.filter((row) => row.kind === "customer");
  const customerEmails = customerRows.map((row) => legacyEmail(row.email)).filter((email): email is string => Boolean(email));
  const duplicateEmails = customerEmails.filter((email, index) => customerEmails.indexOf(email) !== index);
  errors.push(...[...new Set(duplicateEmails)].map((email) => `Duplicate customer row for ${email}.`));
  if (customerEmails.length) {
    const existingCustomers = await prisma.customer.findMany({
      where: { emailNormalized: { in: customerEmails } },
      select: { emailNormalized: true },
    });
    errors.push(...existingCustomers.map((customer) => `Customer ${customer.emailNormalized} already exists; legacy imports never overwrite customer data.`));
  }

  const orderNumbers = new Map<string, number>();
  const orderRows = rows.filter((row) => row.kind === "order" && Number.isInteger(Number(row.order_number)) && Number(row.order_number) > 0);
  for (const [index, row] of orderRows.entries()) {
    const key = `${row.year}:${row.order_number}`;
    if (orderNumbers.has(key)) errors.push(`Order row ${index + 2} repeats order_number ${row.order_number} for ${row.year}.`);
    orderNumbers.set(key, index);
  }
  if (orderRows.length) {
    const seasons = await prisma.season.findMany({
      where: { year: { in: [...new Set(orderRows.map((row) => Number(row.year)))] } },
      select: { id: true, year: true },
    });
    const seasonById = new Map(seasons.map((season) => [season.id, season.year]));
    const existingOrders = await prisma.order.findMany({
      where: {
        seasonId: { in: seasons.map((season) => season.id) },
        orderNumber: { in: orderRows.map((row) => Number(row.order_number)) },
      },
      select: { seasonId: true, orderNumber: true },
    });
    for (const order of existingOrders) {
      if (order.orderNumber !== null && orderNumbers.has(`${seasonById.get(order.seasonId)}:${order.orderNumber}`)) {
        errors.push(`Order number ${order.orderNumber} already exists for ${seasonById.get(order.seasonId)}.`);
      }
    }
  }
  return errors;
}

export async function performanceReport() {
  const seasons = await prisma.season.findMany({
    orderBy: { year: "desc" },
    include: {
      orders: { where: { status: "FINALIZED" }, select: { id: true, totalCents: true, fulfillmentCents: true, paymentStatus: true } },
    },
  });
  return seasons.map((season) => ({
    seasonId: season.id,
    season: season.name,
    year: season.year,
    orders: season.orders.length,
    ...season.orders.reduce((totals, order) => ({
      grossCents: totals.grossCents + order.totalCents,
      fulfillmentCents: totals.fulfillmentCents + order.fulfillmentCents,
    }), { grossCents: 0, fulfillmentCents: 0 }),
    paidOrders: season.orders.filter((order) => order.paymentStatus === "POSTED").length,
  }));
}

export async function shippingMarginReport() {
  const shipments = await prisma.shipmentBox.findMany({
    where: { chargedCents: { not: null }, labelCostCents: { not: null } },
    include: { package: { include: { order: { include: { season: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  const packages = shipments.map((shipment) => ({
    shipmentId: shipment.id,
    packageId: shipment.packageId,
    orderNumber: shipment.package?.order.orderNumber ?? null,
    seasonId: shipment.package?.order.season.id ?? "unassigned",
    season: shipment.package?.order.season.name ?? "Unassigned",
    chargedCents: shipment.chargedCents ?? 0,
    paidCents: shipment.labelCostCents ?? 0,
    marginCents: shipment.marginCents ?? 0,
    carrier: shipment.carrier ?? "Pending",
  }));
  const totals = packages.reduce<Record<string, { season: string; chargedCents: number; paidCents: number; marginCents: number }>>((report, entry) => {
    const current = report[entry.seasonId] ?? { season: entry.season, chargedCents: 0, paidCents: 0, marginCents: 0 };
    current.chargedCents += entry.chargedCents;
    current.paidCents += entry.paidCents;
    current.marginCents += entry.marginCents;
    report[entry.seasonId] = current;
    return report;
  }, {});
  return { packages, totals };
}

export async function exportCsv(dataset: CsvDataset) {
  if (dataset === "shipping_margin") {
    const report = await shippingMarginReport();
    return ["season,order_number,carrier,charged_cents,paid_cents,margin_cents", ...report.packages.map((entry) => [
      entry.season, entry.orderNumber ?? "", entry.carrier, entry.chargedCents, entry.paidCents, entry.marginCents,
    ].map(csvCell).join(","))].join("\n");
  }
  if (dataset === "item_sales") {
    const lines = await prisma.orderLine.findMany({ include: { order: { include: { season: true } } } });
    return ["season,sku,product,quantity,unit_price_cents", ...lines.map((line) => [
      line.order.season.name, line.skuSnapshot, line.productNameSnapshot, line.quantity, line.unitPriceCents,
    ].map(csvCell).join(","))].join("\n");
  }
  const report = await performanceReport();
  return ["season,year,orders,gross_cents,fulfillment_cents,paid_orders", ...report.map((entry) => [
    entry.season, entry.year, entry.orders, entry.grossCents, entry.fulfillmentCents, entry.paidOrders,
  ].map(csvCell).join(","))].join("\n");
}

export async function runStripeReconciliation(actorId: string | null) {
  const orphaned = await prisma.stripePaymentIntent.findMany({ where: { paymentId: null }, select: { id: true, stripeIntentId: true, amountCents: true, status: true } });
  for (const intent of orphaned) {
    const subjectId = `stripe-orphan:${intent.id}`;
    if (!await prisma.auditEvent.findFirst({ where: { action: "stripe.reconciliation_flagged", subjectId } })) {
      await prisma.auditEvent.create({ data: { actorId, action: "stripe.reconciliation_flagged", subjectId, details: intent } });
    }
  }
  await prisma.auditEvent.create({ data: { actorId, action: "stripe.reconciliation_run", details: { orphaned: orphaned.length } } });
  return { orphaned };
}

export async function stageLegacyImport(csv: string, actorId: string) {
  const parsed = parseCsv(csv);
  const errors = [...parsed.errors, ...validateLegacyRows(parsed.rows), ...await validateLegacyReferences(parsed.rows)];
  const batchId = randomUUID();
  const stage: LegacyStage = { actorId, rows: parsed.rows, errors, createdAt: new Date().toISOString() };
  await prisma.appSetting.create({ data: { key: `legacy-import:${batchId}`, value: stage } });
  await prisma.auditEvent.create({ data: { actorId, action: "legacy_import.dry_run", subjectId: batchId, details: { rows: parsed.rows.length, errors } } });
  return { batchId, accepted: errors.length ? 0 : parsed.rows.length, errors, mapping: "customer email/phone → Customer; year + SKU → Product; order → finalized Order + address review" };
}

export async function commitLegacyImport(batchId: string, actorId: string) {
  const staged = await prisma.appSetting.findUnique({ where: { key: `legacy-import:${batchId}` } });
  const stage = staged?.value as unknown as LegacyStage | undefined;
  if (!stage || stage.actorId !== actorId) throw new Error("The staged legacy import was not found for this staff member.");
  if (stage.errors.length) throw new Error("Resolve every legacy import error before committing.");
  await prisma.$transaction(async (transaction) => {
    for (const [index, row] of stage.rows.entries()) {
      if (row.kind === "customer") {
        const emailNormalized = legacyEmail(row.email)!;
        if (await transaction.customer.findUnique({ where: { emailNormalized }, select: { id: true } })) {
          throw new Error(`Customer ${emailNormalized} already exists; legacy imports never overwrite customer data.`);
        }
        await transaction.customer.create({
          data: { firstName: row.first_name, lastName: row.last_name, emailNormalized, phoneNormalized: row.phone ? normalizePhone(row.phone) : null },
        });
      }
      if (row.kind === "product") {
        const year = Number(row.year);
        const season = await transaction.season.upsert({ where: { year }, create: { year, name: `Purim ${year}`, status: "CLOSED" }, update: {} });
        await transaction.product.upsert({
          where: { seasonId_sku: { seasonId: season.id, sku: row.sku } },
          create: { seasonId: season.id, sku: row.sku, name: row.product_name, priceCents: Number(row.price_cents), kind: "PACKAGE" },
          update: { name: row.product_name, priceCents: Number(row.price_cents) },
        });
      }
      if (row.kind === "order") {
        const season = await transaction.season.findUniqueOrThrow({ where: { year: Number(row.year) } });
        const customer = await transaction.customer.findUniqueOrThrow({ where: { emailNormalized: legacyEmail(row.email)! } });
        const product = await transaction.product.findUnique({ where: { seasonId_sku: { seasonId: season.id, sku: row.sku } } });
        if (!product) throw new Error(`Order row ${index + 2} references missing ${row.sku}.`);
        const address = await transaction.address.upsert({
          where: { customerId_normalizedAddress: { customerId: customer.id, normalizedAddress: legacyAddress(row) } },
          create: {
            customerId: customer.id, recipientName: row.recipient_name || `${customer.firstName} ${customer.lastName}`, line1: row.line1, line2: row.line2 || null,
            city: row.city, state: row.state.toUpperCase(), postalCode: row.postal_code, normalizedAddress: legacyAddress(row),
            reviewStatus: "PENDING", reviewReason: "Imported legacy address needs staff confirmation.",
          },
          update: { recipientName: row.recipient_name || `${customer.firstName} ${customer.lastName}` },
        });
        await transaction.order.create({
          data: {
            seasonId: season.id, customerId: customer.id, status: "FINALIZED", orderNumber: Number(row.order_number) || null,
            draftReference: `LEGACY-${batchId.slice(0, 8)}-${index}`, totalCents: Number(row.total_cents), paymentStatus: "POSTED",
            wireFormat: { version: 1, legacyBatchId: batchId, sourceOrderNumber: row.order_number },
            lines: { create: { productId: product.id, quantity: Number(row.quantity) || 1, productNameSnapshot: product.name, skuSnapshot: product.sku, unitPriceCents: product.priceCents } },
            payments: { create: { method: "COMP", status: "POSTED", amountCents: Number(row.total_cents), postedAt: new Date(), notes: "Imported legacy payment." } },
            packages: { create: { recipientName: row.recipient_name || `${customer.firstName} ${customer.lastName}`, greeting: row.greeting || "", groupingKey: `legacy:${index}`, fulfillmentMethod: { connect: { code: "DELIVERY" } }, address: { connect: { id: address.id } } } },
          },
        });
      }
    }
    await transaction.appSetting.delete({ where: { key: `legacy-import:${batchId}` } });
    await transaction.auditEvent.create({ data: { actorId, action: "legacy_import.committed", subjectId: batchId, details: { rows: stage.rows.length } } });
  });
  return { imported: stage.rows.length };
}

export async function listLegacyAddressReviewQueue() {
  return prisma.address.findMany({
    where: { reviewStatus: "PENDING" },
    include: { customer: { select: { firstName: true, lastName: true, emailNormalized: true } } },
    orderBy: { id: "desc" },
    take: 100,
  });
}

export async function approveLegacyAddress(addressId: string, actorId: string) {
  return prisma.$transaction(async (transaction) => {
    const address = await transaction.address.update({
      where: { id: addressId },
      data: { reviewStatus: "APPROVED", reviewReason: null, reviewedAt: new Date() },
    });
    await transaction.auditEvent.create({
      data: { actorId, action: "legacy_import.address_approved", subjectId: address.id, details: { customerId: address.customerId } },
    });
    return address;
  });
}
