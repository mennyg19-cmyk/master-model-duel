import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { parseCsv } from "@/lib/csv";
import { normalizePhone } from "@/lib/customers";
import { normalizedAddressKey } from "@/lib/addresses/normalize";
import { newDraftReference } from "@/lib/domain/draft-reference";

// Legacy migration pipeline (R-165, R-186, G-029, UR-014).
//
// Entity map (legacy export column -> new model — documented in README too):
//   order_number                       -> Order.orderNumber (repaired when blank/duplicate)
//   order_date                         -> Order.finalizedAt; year names the "Legacy YYYY" season
//   customer_name/email/phone          -> Customer (merged on email, then on normalized phone)
//   product_name / product_price       -> Product in the legacy season (slug from name)
//   quantity                           -> OrderLine.quantity
//   recipient_name, address, city,
//   state, zip                         -> OrderLine snapshot + CustomerAddress book entry
//   method                             -> FulfillmentMethod by keyword (delivery/ship/pickup/purim)
//   greeting                           -> OrderLine.greeting
//
// The pipeline is dry-run first: parse + normalize + plan, write NOTHING, and
// store the report on a LegacyImportRun keyed by the file's hash. Commit
// re-derives the same plan from the same bytes and writes it in four staged
// atomic transactions (catalog -> customers -> addresses -> orders); each
// stage records a LegacyImportStage row inside its own transaction, so an
// interruption between stages resumes exactly where it stopped.

export const LEGACY_HEADERS = [
  "order_number", "order_date", "customer_name", "customer_email", "customer_phone",
  "product_name", "product_price", "quantity", "recipient_name", "address",
  "city", "state", "zip", "method", "greeting",
] as const;

// ponytail: deliberate ceiling — only the nine spelled-out state names seen in
// the legacy export are mapped; anything else normalizes to null and the row
// is review-flagged (never coerced). Upgrade path: swap in a full USPS
// state-name table (or a geocoder) if imports from other regions appear.
// Logged as DECISION-P12-7.
const STATE_NAMES: Record<string, string> = {
  "new jersey": "NJ", "new york": "NY", pennsylvania: "PA", connecticut: "CT",
  maryland: "MD", florida: "FL", california: "CA", illinois: "IL", ohio: "OH",
};

type PlannedCustomer = {
  key: string; // normalized email, or phone:{digits}, or name:{normalized}
  email: string;
  name: string;
  phone: string | null;
  existingId: string | null; // merge target already in the DB
  mergedFromLines: number[]; // extra source lines folded into this customer
};

type PlannedAddress = {
  customerKey: string;
  recipient: string;
  line1: string;
  city: string;
  state: string;
  zip: string;
  normalizedKey: string;
  reviewReason: string | null;
  sourceLine: number;
};

type PlannedLine = {
  productKey: string;
  quantity: number;
  unitPriceCents: number;
  recipient: string;
  line1: string;
  city: string;
  state: string;
  zip: string;
  methodCode: string;
  greeting: string;
};

type PlannedOrder = {
  customerKey: string;
  orderNumber: number;
  numberRepaired: boolean;
  finalizedAt: Date;
  lines: PlannedLine[];
  totalCents: number;
  sourceLines: number[];
};

type PlannedProduct = { key: string; name: string; slug: string; priceCents: number };

export type LegacyPlan = {
  seasonName: string;
  seasonYear: number;
  customers: PlannedCustomer[];
  products: PlannedProduct[];
  addresses: PlannedAddress[];
  orders: PlannedOrder[];
  invalidRows: { line: number; reason: string }[];
  repairs: { line: number; note: string }[];
  merges: { line: number; note: string }[];
  sourceTotals: { rows: number; orders: number; customers: number; revenueCents: number };
};

export function legacyFileHash(csv: string): string {
  return createHash("sha256").update(csv).digest("hex");
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function normalizeState(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return STATE_NAMES[trimmed.toLowerCase()] ?? null;
}

// Returns null for a method keyword it doesn't recognize — the caller defaults
// to local_delivery but review-flags the row instead of guessing silently
// (DECISION-P12-8, same posture as normalizeState).
function mapMethodCode(raw: string): string | null {
  const lower = raw.toLowerCase();
  if (lower.includes("deliver") || lower.includes("local")) return "local_delivery";
  if (lower.includes("ship")) return "shipping";
  if (lower.includes("pickup") || lower.includes("pick up")) return "pickup";
  if (lower.includes("purim") || lower.includes("day-of")) return "per_package_delivery";
  return null;
}

/** Parse + normalize + plan. Pure: writes nothing; DB reads only for merge targets. */
export async function planLegacyImport(csv: string): Promise<LegacyPlan | { error: string }> {
  const table = parseCsv(csv);
  if ("error" in table) return { error: table.error };
  const missing = LEGACY_HEADERS.filter((header) => !table.headers.includes(header));
  if (missing.length > 0) return { error: `Missing columns: ${missing.join(", ")}` };

  const records = table.rows.map((row, index) => {
    const record: Record<string, string> = {};
    table.headers.forEach((header, col) => (record[header] = (row[col] ?? "").trim()));
    return { line: index + 2, values: record };
  });

  const invalidRows: LegacyPlan["invalidRows"] = [];
  const repairs: LegacyPlan["repairs"] = [];
  const merges: LegacyPlan["merges"] = [];

  // ---- customers: dedupe on email, then normalized phone, then exact name ----
  const customersByKey = new Map<string, PlannedCustomer>();
  const keyByEmail = new Map<string, string>();
  const keyByPhone = new Map<string, string>();
  const customerKeyForLine = new Map<number, string>();

  let seasonYear = 0;

  for (const { line, values } of records) {
    if (!values.product_name) {
      invalidRows.push({ line, reason: "missing product_name — row unusable" });
      continue;
    }
    const priceCents = Math.round(Number.parseFloat(values.product_price || "") * 100);
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      invalidRows.push({ line, reason: `product_price "${values.product_price}" is not a money amount` });
      continue;
    }
    const date = new Date(values.order_date);
    if (Number.isNaN(date.getTime())) {
      invalidRows.push({ line, reason: `order_date "${values.order_date}" is not a date` });
      continue;
    }
    seasonYear = Math.max(seasonYear, date.getFullYear());

    const email = values.customer_email.toLowerCase();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const phone = normalizePhone(values.customer_phone);
    const name = values.customer_name.replace(/\s+/g, " ").trim();
    if (!emailValid && !phone && !name) {
      invalidRows.push({ line, reason: "no usable customer identity (email, phone, and name all missing/bad)" });
      continue;
    }

    let key: string | undefined;
    if (emailValid && keyByEmail.has(email)) key = keyByEmail.get(email);
    else if (phone && keyByPhone.has(phone)) {
      key = keyByPhone.get(phone);
      merges.push({ line, note: `"${email || name}" merged into ${key} — same phone ${phone}` });
      if (emailValid && !keyByEmail.has(email)) keyByEmail.set(email, key!);
    }
    if (!key) {
      key = emailValid ? email : phone ? `phone:${phone}` : `name:${name.toLowerCase()}`;
      if (customersByKey.has(key) && !emailValid) {
        // name-keyed rows collapse into the existing name-keyed customer
      } else if (!customersByKey.has(key)) {
        customersByKey.set(key, {
          key,
          email: emailValid ? email : `legacy+${slugify(name || phone || String(line))}@imported.invalid`,
          name: name || "Imported customer",
          phone: values.customer_phone || null,
          existingId: null,
          mergedFromLines: [],
        });
      }
      if (emailValid) keyByEmail.set(email, key);
      if (phone) keyByPhone.set(phone, key);
    } else {
      customersByKey.get(key)!.mergedFromLines.push(line);
    }
    customerKeyForLine.set(line, key);
  }

  // Merge targets already in the DB (email first, then phone).
  const planned = [...customersByKey.values()];
  const existingByEmail = await db.customer.findMany({
    where: { email: { in: planned.map((customer) => customer.email) } },
    select: { id: true, email: true },
  });
  const existingEmailMap = new Map(existingByEmail.map((row) => [row.email, row.id]));
  const phones = planned.map((customer) => normalizePhone(customer.phone)).filter((p): p is string => p !== null);
  const existingByPhone = await db.customer.findMany({
    where: { phoneNormalized: { in: phones } },
    select: { id: true, phoneNormalized: true },
  });
  const existingPhoneMap = new Map(existingByPhone.map((row) => [row.phoneNormalized as string, row.id]));
  for (const customer of planned) {
    customer.existingId =
      existingEmailMap.get(customer.email) ??
      existingPhoneMap.get(normalizePhone(customer.phone) ?? "") ??
      null;
  }

  // ---- products ----
  const productsByKey = new Map<string, PlannedProduct>();

  // ---- addresses (book cleanup: normalize, dedupe on normalizedKey, flag suspects) ----
  const addressesByKey = new Map<string, PlannedAddress>();

  // ---- orders: group usable rows by (order_number, customer); repair numbers ----
  const usable = records.filter(
    ({ line }) => customerKeyForLine.has(line) && !invalidRows.some((invalid) => invalid.line === line)
  );
  const orderGroups = new Map<string, { number: number | null; customerKey: string; rows: typeof usable }>();
  const numberOwner = new Map<number, string>();

  for (const record of usable) {
    const { line, values } = record;
    const customerKey = customerKeyForLine.get(line)!;
    const rawNumber = Number.parseInt(values.order_number, 10);
    const validNumber = Number.isInteger(rawNumber) && rawNumber > 0 ? rawNumber : null;

    let groupKey: string;
    if (validNumber === null) {
      groupKey = `repair|${customerKey}|${values.order_date}`;
      if (!orderGroups.has(groupKey)) repairs.push({ line, note: `blank/bad order number "${values.order_number}" — will assign a fresh one` });
    } else {
      const owner = numberOwner.get(validNumber);
      if (owner && owner !== customerKey) {
        groupKey = `repair|${customerKey}|${validNumber}`;
        if (!orderGroups.has(groupKey)) repairs.push({ line, note: `order number ${validNumber} already used by another customer — will assign a fresh one` });
      } else {
        numberOwner.set(validNumber, customerKey);
        groupKey = `num|${validNumber}|${customerKey}`;
      }
    }
    const group = orderGroups.get(groupKey) ?? { number: groupKey.startsWith("num|") ? validNumber : null, customerKey, rows: [] };
    group.rows.push(record);
    orderGroups.set(groupKey, group);
  }

  let nextRepairNumber = Math.max(0, ...[...numberOwner.keys()]) + 1;
  const orders: PlannedOrder[] = [];

  for (const group of orderGroups.values()) {
    const lines: PlannedLine[] = [];
    const sourceLines: number[] = [];
    let finalizedAt = new Date();

    for (const { line, values } of group.rows) {
      sourceLines.push(line);
      finalizedAt = new Date(values.order_date);

      const productName = values.product_name.replace(/\s+/g, " ").trim();
      const productKey = slugify(productName);
      const priceCents = Math.round(Number.parseFloat(values.product_price) * 100);
      if (!productsByKey.has(productKey)) {
        productsByKey.set(productKey, { key: productKey, name: productName, slug: productKey, priceCents });
      }

      // Address normalization + review flags (UR-014).
      const state = normalizeState(values.state);
      const zipDigits = values.zip.replace(/\D/g, "");
      const zipValid = /^\d{5}$/.test(zipDigits);
      const mappedMethod = mapMethodCode(values.method);
      if (mappedMethod === null) {
        repairs.push({ line, note: `method "${values.method}" not recognized — defaulted to local delivery, review before relying on it` });
      }
      let reviewReason: string | null = null;
      if (!state) reviewReason = `state "${values.state}" is not recognizable`;
      else if (!zipValid) reviewReason = `zip "${values.zip}" is not 5 digits`;
      else if (values.address.length < 3 || !/\d/.test(values.address)) reviewReason = `street "${values.address}" has no house number`;
      else if (mappedMethod === null) reviewReason = `method "${values.method}" is not recognizable — defaulted to local delivery`;

      const recipient = (values.recipient_name || values.customer_name || "Recipient").replace(/\s+/g, " ").trim();
      const safeState = state ?? values.state.slice(0, 2).toUpperCase().padEnd(2, "X");
      const safeZip = zipValid ? zipDigits : zipDigits.padStart(5, "0").slice(0, 5) || "00000";
      const addressInput = { recipient, line1: values.address || "Unknown", city: values.city || "Unknown", state: safeState, zip: safeZip };
      const normalizedKey = normalizedAddressKey(addressInput);
      const customerKey = customerKeyForLine.get(line)!;
      const bookKey = `${customerKey}|${normalizedKey}`;
      if (!addressesByKey.has(bookKey)) {
        addressesByKey.set(bookKey, { customerKey, ...addressInput, normalizedKey, reviewReason, sourceLine: line });
      }

      const quantity = Math.max(1, Number.parseInt(values.quantity, 10) || 1);
      lines.push({
        productKey,
        quantity,
        unitPriceCents: priceCents,
        recipient,
        line1: addressInput.line1,
        city: addressInput.city,
        state: safeState,
        zip: safeZip,
        methodCode: mappedMethod ?? "local_delivery",
        greeting: values.greeting,
      });
    }

    const number = group.number ?? nextRepairNumber++;
    orders.push({
      customerKey: group.customerKey,
      orderNumber: number,
      numberRepaired: group.number === null,
      finalizedAt,
      lines,
      totalCents: lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0),
      sourceLines,
    });
  }

  return {
    seasonName: `Legacy ${seasonYear || new Date().getFullYear()}`,
    seasonYear: seasonYear || new Date().getFullYear(),
    customers: planned,
    products: [...productsByKey.values()],
    addresses: [...addressesByKey.values()],
    orders,
    invalidRows,
    repairs,
    merges,
    sourceTotals: {
      rows: records.length,
      orders: orders.length,
      customers: planned.length,
      revenueCents: orders.reduce((sum, order) => sum + order.totalCents, 0),
    },
  };
}

const STAGES = ["catalog", "customers", "addresses", "orders"] as const;
export type LegacyStage = (typeof STAGES)[number];

export type CommitResult = {
  runId: string;
  completedStages: { stage: string; counts: Record<string, number>; skipped: boolean }[];
  status: "COMPLETED" | "COMMITTING";
};

/**
 * Staged atomic commit. Each stage is one transaction that writes its rows AND
 * its LegacyImportStage marker; a crash between stages leaves the run
 * COMMITTING and a re-commit of the same file resumes at the first missing
 * stage. `stopAfterStage` exists for the interruption smoke — it ends the
 * commit cleanly after that stage, exactly like a crash would.
 */
export async function commitLegacyImport(
  runId: string,
  plan: LegacyPlan,
  options: { stopAfterStage?: LegacyStage } = {}
): Promise<CommitResult> {
  await db.legacyImportRun.update({ where: { id: runId }, data: { status: "COMMITTING" } });
  const doneStages = new Set(
    (await db.legacyImportStage.findMany({ where: { runId }, select: { stage: true } })).map((row) => row.stage)
  );
  const completed: CommitResult["completedStages"] = [];

  // Cross-stage id maps are rebuilt from the DB on resume (deterministic keys).
  const customerIds = new Map<string, string>();
  const productIds = new Map<string, string>();
  let seasonId = "";

  const loadCatalogIds = async () => {
    const season = await db.season.findUnique({ where: { name: plan.seasonName } });
    if (!season) throw new Error(`Legacy season ${plan.seasonName} missing — catalog stage did not run`);
    seasonId = season.id;
    const products = await db.product.findMany({ where: { seasonId }, select: { id: true, slug: true } });
    for (const product of products) productIds.set(product.slug, product.id);
  };
  const loadCustomerIds = async () => {
    const rows = await db.customer.findMany({
      where: { email: { in: plan.customers.map((customer) => customer.email) } },
      select: { id: true, email: true },
    });
    const byEmail = new Map(rows.map((row) => [row.email, row.id]));
    for (const customer of plan.customers) {
      const id = customer.existingId ?? byEmail.get(customer.email);
      if (!id) throw new Error(`Customer ${customer.email} missing — customers stage did not run`);
      customerIds.set(customer.key, id);
    }
  };

  for (const stage of STAGES) {
    if (doneStages.has(stage)) {
      completed.push({ stage, counts: {}, skipped: true });
      if (stage === "catalog") await loadCatalogIds();
      if (stage === "customers") await loadCustomerIds();
      continue;
    }

    if (stage === "catalog") {
      await db.$transaction(async (tx) => {
        const season = await tx.season.upsert({
          where: { name: plan.seasonName },
          update: {},
          create: { name: plan.seasonName, status: "CLOSED" },
        });
        seasonId = season.id;
        // Repeat-order bridge (S4): a legacy product points its replacement at
        // the closest-priced active product in the open season, so P10's chain
        // resolution maps imported history onto today's catalog.
        const openSeason = await tx.season.findFirst({ where: { status: "OPEN" } });
        const activeProducts = openSeason
          ? await tx.product.findMany({ where: { seasonId: openSeason.id, isActive: true }, select: { id: true, basePriceCents: true } })
          : [];
        const closestActive = (priceCents: number) =>
          activeProducts.length === 0
            ? null
            : activeProducts.reduce((best, candidate) =>
                Math.abs(candidate.basePriceCents - priceCents) < Math.abs(best.basePriceCents - priceCents) ? candidate : best
              ).id;
        for (const product of plan.products) {
          const row = await tx.product.upsert({
            where: { seasonId_slug: { seasonId, slug: product.slug } },
            update: {},
            create: {
              seasonId,
              name: product.name,
              slug: product.slug,
              basePriceCents: product.priceCents,
              isActive: false,
              description: "Imported from the legacy system.",
              replacementId: closestActive(product.priceCents),
            },
          });
          productIds.set(product.slug, row.id);
        }
        await tx.legacyImportStage.create({
          data: { runId, stage, counts: { seasons: 1, products: plan.products.length } },
        });
      });
      completed.push({ stage, counts: { seasons: 1, products: plan.products.length }, skipped: false });
    }

    if (stage === "customers") {
      await db.$transaction(async (tx) => {
        const taken = new Set(
          (
            await tx.customer.findMany({
              where: { phoneNormalized: { in: plan.customers.map((c) => normalizePhone(c.phone)).filter((p): p is string => !!p) } },
              select: { phoneNormalized: true },
            })
          ).map((row) => row.phoneNormalized as string)
        );
        for (const customer of plan.customers) {
          if (customer.existingId) {
            customerIds.set(customer.key, customer.existingId);
            continue;
          }
          const phoneNormalized = normalizePhone(customer.phone);
          const phoneFree = phoneNormalized !== null && !taken.has(phoneNormalized);
          if (phoneNormalized) taken.add(phoneNormalized);
          const row = await tx.customer.upsert({
            where: { email: customer.email },
            update: {},
            create: {
              email: customer.email,
              name: customer.name,
              phone: customer.phone,
              phoneNormalized: phoneFree ? phoneNormalized : null,
            },
          });
          customerIds.set(customer.key, row.id);
        }
        await tx.legacyImportStage.create({ data: { runId, stage, counts: { customers: plan.customers.length } } });
      });
      completed.push({ stage, counts: { customers: plan.customers.length }, skipped: false });
    }

    if (stage === "addresses") {
      await db.$transaction(async (tx) => {
        let created = 0;
        let flagged = 0;
        for (const address of plan.addresses) {
          const customerId = customerIds.get(address.customerKey);
          if (!customerId) continue;
          const row = await tx.customerAddress.upsert({
            where: { customerId_normalizedKey: { customerId, normalizedKey: address.normalizedKey } },
            update: {},
            create: {
              customerId,
              normalizedKey: address.normalizedKey,
              recipient: address.recipient,
              line1: address.line1,
              city: address.city,
              state: address.state,
              zip: address.zip,
            },
          });
          created += 1;
          if (address.reviewReason) {
            await tx.addressReviewItem.create({
              data: {
                runId,
                customerId,
                addressId: row.id,
                reason: address.reviewReason,
                detail: { sourceLine: address.sourceLine, recipient: address.recipient, line1: address.line1 },
              },
            });
            flagged += 1;
          }
        }
        await tx.legacyImportStage.create({ data: { runId, stage, counts: { addresses: created, flagged } } });
      });
      const flagged = plan.addresses.filter((address) => address.reviewReason).length;
      completed.push({ stage, counts: { addresses: plan.addresses.length, flagged }, skipped: false });
    }

    if (stage === "orders") {
      await db.$transaction(async (tx) => {
        const methods = await tx.fulfillmentMethod.findMany({ select: { id: true, code: true } });
        const methodByCode = new Map(methods.map((method) => [method.code, method.id]));
        const fallbackMethod = methodByCode.get("local_delivery") ?? methods[0].id;
        let orderCount = 0;
        for (const order of plan.orders) {
          const customerId = customerIds.get(order.customerKey);
          if (!customerId) continue;
          await tx.order.create({
            data: {
              seasonId,
              customerId,
              status: "FINALIZED",
              draftReference: newDraftReference(),
              orderNumber: order.orderNumber,
              itemsCents: order.totalCents,
              totalCents: order.totalCents,
              paymentStatus: "PAID",
              finalizedAt: order.finalizedAt,
              createdAt: order.finalizedAt,
              // Historical orders arrive settled: one CHECK row keeps the
              // ledger consistent with paymentStatus (reports reconcile).
              payments: {
                create: { method: "CHECK", amountCents: order.totalCents, note: "Legacy import — settled historically" },
              },
              lines: {
                create: order.lines.map((line) => ({
                  productId: productIds.get(line.productKey)!,
                  quantity: line.quantity,
                  unitPriceCents: line.unitPriceCents,
                  recipientName: line.recipient,
                  addressLine1: line.line1,
                  city: line.city,
                  state: line.state,
                  zip: line.zip,
                  fulfillmentMethodId: methodByCode.get(line.methodCode) ?? fallbackMethod,
                  greeting: line.greeting,
                })),
              },
            },
          });
          orderCount += 1;
        }
        // Season counter covers the imported numbers so future numbering never collides.
        const maxNumber = Math.max(0, ...plan.orders.map((order) => order.orderNumber));
        await tx.season.update({ where: { id: seasonId }, data: { orderCounter: maxNumber } });
        await tx.legacyImportStage.create({ data: { runId, stage, counts: { orders: orderCount } } });
      }, { timeout: 60_000 });
      completed.push({ stage, counts: { orders: plan.orders.length }, skipped: false });
    }

    if (options.stopAfterStage === stage) {
      return { runId, completedStages: completed, status: "COMMITTING" };
    }
  }

  await db.legacyImportRun.update({ where: { id: runId }, data: { status: "COMPLETED" } });
  return { runId, completedStages: completed, status: "COMPLETED" };
}