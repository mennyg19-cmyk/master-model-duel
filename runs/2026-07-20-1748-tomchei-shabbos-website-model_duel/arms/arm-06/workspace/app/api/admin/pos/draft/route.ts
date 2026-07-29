import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { getOpenSeason } from "@/lib/seasons/queries";
import { saveDraft } from "@/lib/orders/drafts";

export const dynamic = "force-dynamic";

// R-059: POS draft save — staff build the cart for the counter customer.
// Same engine as the web builder (create-or-replace); the customer id comes
// from the staff-picked customer, never from a session. Address-book writes
// stay enabled (UR-014: POS-floor staff edit books).
const recipientSchema = z.object({
  clientId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  line1: z.string().trim().min(2).max(120),
  line2: z.string().trim().max(120).nullish(),
  city: z.string().trim().min(1).max(80),
  region: z.string().trim().min(1).max(40),
  postalCode: z.string().trim().min(3).max(12),
  country: z.string().trim().min(2).max(2).default("US"),
  addressId: z.string().max(64).nullish(),
  saveToBook: z.boolean().optional(),
  label: z.string().trim().max(60).nullish(),
});

const lineSchema = z.object({
  id: z.string().max(64).optional(),
  productId: z.string().max(64).optional(),
  optionValueId: z.string().max(64).nullish(),
  addOnId: z.string().max(64).optional(),
  parentLineId: z.string().max(64).optional(),
  qty: z.number().int().positive().max(999),
  recipientClientId: z.string().max(64).nullish(),
});

const saveSchema = z.object({
  customerId: z.string().min(1),
  draftRef: z.string().max(32).optional(),
  lines: z.array(lineSchema).max(200),
  recipients: z.array(recipientSchema).max(200).default([]),
});

export async function POST(request: Request) {
  const gate = await requireApiPermission("payments.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, saveSchema, "Draft body is invalid");
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (!body.draftRef && body.lines.length === 0) {
    return NextResponse.json({ error: "Cart is empty — nothing to save" }, { status: 422 });
  }

  const season = await getOpenSeason();
  if (!season) {
    return NextResponse.json({ error: "Ordering is closed for this season" }, { status: 409 });
  }

  const customer = await prisma.customer.findUnique({ where: { id: body.customerId } });
  if (!customer) {
    return NextResponse.json({ error: "Unknown customer" }, { status: 404 });
  }

  let draftOrderId: string | undefined;
  if (body.draftRef) {
    const existing = await prisma.order.findUnique({ where: { draftRef: body.draftRef } });
    if (!existing || existing.status !== "DRAFT" || existing.customerId !== customer.id) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    draftOrderId = existing.id;
  }

  try {
    const order = await saveDraft({
      seasonId: season.id,
      customerId: customer.id,
      draftOrderId,
      lines: body.lines.map((line) => ({ ...line, optionValueId: line.optionValueId ?? undefined })),
      recipients: body.recipients,
      allowBookWrites: true,
    });
    return NextResponse.json({
      ok: true,
      draftRef: order.draftRef,
      orderId: order.id,
      totalCents: order.totalCents,
      version: order.version,
    });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
