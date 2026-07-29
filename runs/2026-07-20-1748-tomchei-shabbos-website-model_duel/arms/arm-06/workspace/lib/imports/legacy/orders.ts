import { PaymentMethod, Prisma } from "@prisma/client";
import { normalizeEmail } from "@/lib/text";
import { normalizePhone } from "@/lib/phone";
import { addressDedupeKey } from "@/lib/customers/addresses";
import { claimOrderNumber, formatWireFormat } from "@/lib/orders/numbers";
import { postPaymentTx } from "@/lib/payments/post";
import { ImportPayload, KindHandler, StagedRow } from "@/lib/imports/engine";
import { legacySeason } from "@/lib/imports/legacy/seasons";
import { normalizeRegion, normalizeZip, titleCaseName } from "@/lib/imports/legacy/normalize";

// R-186/G-029: historical orders from the messy legacy export. One CSV row
// per LINE ITEM; rows sharing legacy_order_no commit as one FINALIZED order
// in the "Legacy <year>" season. Order-number repair is unconditional: every
// imported order claims a clean per-season sequential number + wire format,
// and the old system's number (often broken, duplicated, or free-text) is
// preserved verbatim on Order.legacyRef.
//
// Unknown products become inactive $0 stubs (same law as the P10 repeat
// hook), so a repeat of the imported order lands on the review page with
// price-smart suggestions — that page IS the correction UI. Line snapshots
// keep the CSV's declared unit prices, so imported totals reconcile against
// the source export.
//
// Columns: legacy_order_no, order_date, email, phone, customer_name,
// item_name, item_qty, item_unit_price, shipping_cents, total_cents,
// payment_method, payment_status, recipient_name, recipient_line1,
// recipient_line2, recipient_city, recipient_region, recipient_postal_code,
// greeting.
interface LegacyOrderRow {
  legacyOrderNo: string;
  orderDate: string;
  year: number;
  email: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  customerName: string | null;
  itemName: string;
  itemQty: number;
  unitPriceCents: number;
  shippingCents: number;
  totalCents: number | null;
  paymentMethod: PaymentMethod;
  paymentStatus: "paid" | "unpaid" | "refunded";
  recipientName: string | null;
  recipientLine1: string | null;
  recipientLine2: string | null;
  recipientCity: string | null;
  recipientRegion: string | null;
  recipientPostalCode: string | null;
  greeting: string | null;
}

function parseMoney(raw: string, column: string): number | { error: string } {
  const cleaned = raw.trim().replace(/^\$/, "");
  const value = Number(cleaned);
  if (cleaned === "" || !Number.isFinite(value) || value < 0) {
    return { error: `${column} must be a non-negative number (got "${raw}")` };
  }
  return Math.round(value * 100);
}

function parseLegacyOrderRow(rowNumber: number, record: Record<string, string>): StagedRow {
  const itemPrice = parseMoney(record.item_unit_price ?? "", "item_unit_price");
  const shipping = parseMoney(record.shipping_cents ?? "0", "shipping_cents");
  const totalRaw = (record.total_cents ?? "").trim();
  const total = totalRaw === "" ? null : parseMoney(totalRaw, "total_cents");
  const qty = Number((record.item_qty ?? "").trim());
  const method = (record.payment_method ?? "").trim().toLowerCase();
  const payment = (record.payment_status ?? "paid").trim().toLowerCase();
  const orderDate = (record.order_date ?? "").trim();
  const parsedDate = new Date(orderDate);

  const data: LegacyOrderRow = {
    legacyOrderNo: (record.legacy_order_no ?? "").trim(),
    orderDate,
    year: Number.isNaN(parsedDate.getTime()) ? 0 : parsedDate.getUTCFullYear(),
    email: normalizeEmail(record.email ?? "") || null,
    phone: record.phone?.trim() || null,
    normalizedPhone: normalizePhone(record.phone ?? ""),
    customerName: record.customer_name ? titleCaseName(record.customer_name) : null,
    itemName: titleCaseName(record.item_name ?? ""),
    itemQty: Number.isInteger(qty) && qty > 0 ? qty : 0,
    unitPriceCents: typeof itemPrice === "number" ? itemPrice : 0,
    shippingCents: typeof shipping === "number" ? shipping : 0,
    totalCents: typeof total === "number" ? total : null,
    paymentMethod: method === "cash" ? "CASH" : method === "check" ? "CHECK" : method === "comp" ? "COMP" : "STRIPE",
    paymentStatus: payment === "unpaid" || payment === "refunded" ? payment : "paid",
    recipientName: record.recipient_name ? titleCaseName(record.recipient_name) : null,
    recipientLine1: record.recipient_line1?.trim() || null,
    recipientLine2: record.recipient_line2?.trim() || null,
    recipientCity: record.recipient_city ? titleCaseName(record.recipient_city) : null,
    recipientRegion: record.recipient_region ? normalizeRegion(record.recipient_region) : null,
    recipientPostalCode: normalizeZip(record.recipient_postal_code ?? ""),
    greeting: record.greeting?.trim() || null,
  };
  const staged: StagedRow = { row: rowNumber, data: data as unknown as StagedRow["data"], verdict: "valid" };

  if (!data.legacyOrderNo) return { ...staged, verdict: "invalid", reason: "legacy_order_no is required" };
  if (!orderDate || Number.isNaN(parsedDate.getTime())) {
    return { ...staged, verdict: "invalid", reason: `order_date "${orderDate}" is not a date` };
  }
  if (!data.email && !data.normalizedPhone) {
    return { ...staged, verdict: "invalid", reason: "no usable customer contact (email and phone both broken)" };
  }
  if (!data.itemName) return { ...staged, verdict: "invalid", reason: "item_name is required" };
  if (data.itemQty === 0) return { ...staged, verdict: "invalid", reason: "item_qty must be a positive integer" };
  if (typeof itemPrice !== "number") return { ...staged, verdict: "invalid", reason: itemPrice.error };
  if (typeof shipping !== "number") return { ...staged, verdict: "invalid", reason: shipping.error };
  if (total !== null && typeof total !== "number") return { ...staged, verdict: "invalid", reason: total.error };
  if (method && !["card", "cash", "check", "comp"].includes(method)) {
    return { ...staged, verdict: "invalid", reason: `payment_method "${record.payment_method}" — expected card|cash|check|comp` };
  }
  if (payment && !["paid", "unpaid", "refunded"].includes(payment)) {
    return { ...staged, verdict: "invalid", reason: `payment_status "${record.payment_status}" — expected paid|unpaid|refunded` };
  }
  return staged;
}

async function markOrderDuplicates(tx: Prisma.TransactionClient, rows: StagedRow[]): Promise<void> {
  const orderNos = [...new Set(rows.filter((r) => r.verdict === "valid").map((r) => (r.data as unknown as LegacyOrderRow).legacyOrderNo))];
  if (orderNos.length === 0) return;
  const existing = await tx.order.findMany({ where: { legacyRef: { in: orderNos } }, select: { legacyRef: true } });
  const taken = new Set(existing.map((order) => order.legacyRef));
  for (const row of rows) {
    if (row.verdict !== "valid") continue;
    const no = (row.data as unknown as LegacyOrderRow).legacyOrderNo;
    if (taken.has(no)) {
      row.verdict = "duplicate";
      row.reason = `legacy order ${no} already imported (Order.legacyRef) — left alone`;
    }
  }
}

// Email and phone are both dedupe keys (R-144); when they point at DIFFERENT
// existing customers the row is ambiguous — a human merges the customers, the
// import never guesses (G-029 human mapping for messy rows).
async function resolveCustomer(tx: Prisma.TransactionClient, head: LegacyOrderRow): Promise<{ id: string } | { error: string }> {
  const byEmail = head.email ? await tx.customer.findUnique({ where: { email: head.email } }) : null;
  const byPhone = head.normalizedPhone ? await tx.customer.findUnique({ where: { normalizedPhone: head.normalizedPhone } }) : null;
  if (byEmail && byPhone && byEmail.id !== byPhone.id) {
    return { error: `email matches "${byEmail.name}" but phone matches "${byPhone.name}" — merge those customers first` };
  }
  const existing = byEmail ?? byPhone;
  if (existing) return { id: existing.id };
  const email = head.email ?? `legacy-phone-${(head.normalizedPhone ?? "unknown").replace(/\D/g, "")}@legacy.local`;
  const created = await tx.customer.create({
    data: {
      email,
      name: head.customerName ?? email.split("@")[0],
      phone: head.phone,
      normalizedPhone: head.normalizedPhone,
    },
  });
  return { id: created.id };
}

function stubSlug(year: number, productName: string): string {
  return `legacy-${year}-${productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

async function commitLegacyOrderRows(
  tx: Prisma.TransactionClient,
  rows: StagedRow[],
  _payload: ImportPayload,
): Promise<number> {
  const groups = new Map<string, { row: StagedRow; data: LegacyOrderRow }[]>();
  for (const row of rows) {
    if (row.verdict !== "valid") continue;
    const data = row.data as unknown as LegacyOrderRow;
    const group = groups.get(data.legacyOrderNo) ?? [];
    group.push({ row, data });
    groups.set(data.legacyOrderNo, group);
  }

  let landed = 0;
  for (const [orderNo, members] of groups) {
    const head = members[0].data;
    const season = await legacySeason(tx, head.year);

    const customer = await resolveCustomer(tx, head);
    if ("error" in customer) {
      for (const { row } of members) {
        row.verdict = "invalid";
        row.reason = customer.error;
      }
      continue;
    }

    // Recipient: explicit columns win; otherwise the customer's first clean
    // book address fills in (UR-014 — the book is the year-one memory).
    let recipient = {
      name: head.recipientName ?? head.customerName ?? "Legacy recipient",
      line1: head.recipientLine1,
      line2: head.recipientLine2,
      city: head.recipientCity,
      region: head.recipientRegion,
      postalCode: head.recipientPostalCode,
      addressId: null as string | null,
    };
    if (!recipient.line1) {
      const book = await tx.address.findMany({
        where: { customerId: customer.id, needsReview: false },
        orderBy: [{ createdAt: "asc" }],
      });
      const fallback = book[0];
      if (fallback) {
        recipient = {
          name: recipient.name,
          line1: fallback.line1,
          line2: fallback.line2,
          city: fallback.city,
          region: fallback.region,
          postalCode: fallback.postalCode,
          addressId: fallback.id,
        };
      }
    } else {
      const book = await tx.address.findMany({ where: { customerId: customer.id } });
      const key = addressDedupeKey({
        line1: recipient.line1,
        line2: recipient.line2,
        city: recipient.city ?? "",
        region: recipient.region ?? "",
        postalCode: recipient.postalCode ?? "",
        country: "US",
      });
      recipient.addressId = book.find((address) => addressDedupeKey(address) === key)?.id ?? null;
    }
    if (!recipient.line1 || !recipient.city || !recipient.region || !recipient.postalCode) {
      for (const { row } of members) {
        row.verdict = "invalid";
        row.reason = "no recipient address in the row and none in the customer's book — map one first";
      }
      continue;
    }

    const catalog = await tx.product.findMany({ where: { seasonId: season.id } });
    const byName = new Map(catalog.map((product) => [product.name.toLowerCase(), product]));

    const orderNumber = await claimOrderNumber(tx, season.id);
    const subtotal = members.reduce((sum, { data }) => sum + data.itemQty * data.unitPriceCents, 0);
    // The export's total is authoritative when present (it may embed a
    // discount the old system applied); otherwise lines + shipping. Either
    // way the imported total reconciles against the source file.
    const totalCents = head.totalCents ?? subtotal + head.shippingCents;

    const order = await tx.order.create({
      data: {
        seasonId: season.id,
        customerId: customer.id,
        status: "FINALIZED",
        paymentStatus: head.paymentStatus === "unpaid" ? "UNPAID" : "PAID",
        orderNumber,
        wireFormat: formatWireFormat(season.name, orderNumber),
        legacyRef: orderNo,
        totalCents,
        deliveryFeesCents: head.shippingCents,
        createdAt: new Date(head.orderDate),
      },
    });

    const draftRecipient = await tx.draftRecipient.create({
      data: {
        orderId: order.id,
        name: recipient.name,
        line1: recipient.line1,
        line2: recipient.line2,
        city: recipient.city!,
        region: recipient.region!,
        postalCode: recipient.postalCode!,
        addressId: recipient.addressId,
        greeting: head.greeting,
        deliveryFeeCents: head.shippingCents,
      },
    });

    for (const { data } of members) {
      let product = byName.get(data.itemName.toLowerCase());
      if (!product) {
        product = await tx.product.upsert({
          where: { slug: stubSlug(head.year, data.itemName) },
          update: {},
          create: {
            slug: stubSlug(head.year, data.itemName),
            name: data.itemName,
            seasonId: season.id,
            basePriceCents: 0,
            // Inactive + unmapped: repeat offers price-smart suggestions.
            active: false,
          },
        });
        byName.set(data.itemName.toLowerCase(), product);
      }
      await tx.orderLine.create({
        data: {
          orderId: order.id,
          productId: product.id,
          productName: product.name,
          qty: data.itemQty,
          unitPriceCents: data.unitPriceCents,
          lineTotalCents: data.itemQty * data.unitPriceCents,
          recipientId: draftRecipient.id,
        },
      });
    }

    if (head.paymentStatus === "paid" && totalCents > 0) {
      await postPaymentTx(tx, {
        orderId: order.id,
        method: head.paymentMethod,
        amountCents: totalCents,
        externalRef: `legacy:${orderNo}`,
      });
    }
    // Refunded legacy orders keep paymentStatus PAID with no payment rows:
    // the money was collected AND returned inside the old system (net zero),
    // and a VOIDED pair here would drop the order into this year's collection
    // queues. The entity map documents this terminal-state choice.
    landed += 1;
  }
  return landed;
}

export const legacyOrdersImport: KindHandler = {
  requiredHeaders: ["legacy_order_no", "order_date", "item_name", "item_qty", "item_unit_price"],
  parseRow: parseLegacyOrderRow,
  duplicateKeys: (data) => {
    const row = data as unknown as LegacyOrderRow;
    return [{ key: `${row.legacyOrderNo}|${row.itemName.toLowerCase()}`, label: "order+item" }];
  },
  markDatabaseDuplicates: markOrderDuplicates,
  commitRows: commitLegacyOrderRows,
};
