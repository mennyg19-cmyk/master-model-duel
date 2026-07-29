import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { assertSameOrigin } from "@/lib/public-guard";
import { clientIp } from "@/lib/client-ip";
import { draftSaveRateLimit } from "@/lib/rate-limit";
import { getOpenSeason } from "@/lib/seasons/queries";
import { getCustomerContext } from "@/lib/customers/session";
import { findOrCreateGuestCustomer, VerifiedCustomerExistsError } from "@/lib/customers/dedupe";
import { generateGuestToken, verifyGuestToken } from "@/lib/orders/guest-token";
import { readGuestDraftToken, writeGuestDraftTokenCookie } from "@/lib/orders/guest-draft-cookie";
import { saveDraft } from "@/lib/orders/drafts";

// R-022/R-023: save (create-or-replace) a web draft. Authenticated customers
// save against their account; guests pass identity once and get an access
// token back — later guest saves of the same draft must present it. The raw
// token travels only in an httpOnly cookie (guest-draft-cookie.ts), never in
// URLs or response bodies.
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
  draftRef: z.string().max(32).optional(),
  guest: z
    .object({
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().email().max(200),
      phone: z.string().trim().max(40).nullish(),
    })
    .optional(),
  // Empty lines = clear the existing draft (emptied-cart autosave); a NEW
  // draft still requires at least one line (guard below).
  lines: z.array(lineSchema).max(200),
  recipients: z.array(recipientSchema).max(200).default([]),
});

export async function POST(request: Request) {
  // R-122 public-guard triad, same as the checkout mutations: same-origin,
  // IP rate limit, zod.
  const originBlock = assertSameOrigin(request);
  if (originBlock) return originBlock;
  if (!draftSaveRateLimit(clientIp(request.headers) ?? "unknown")) {
    return NextResponse.json({ error: "Too many saves; wait a moment and try again" }, { status: 429 });
  }

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

  // Resolve the ordering identity: customer session, or guest (cookie token
  // for an existing draft, fresh identity block for a new one).
  const customerCtx = await getCustomerContext();
  let customerId: string;
  let issuedGuestToken: string | undefined;
  let draftOrderId: string | undefined;

  if (customerCtx) {
    customerId = customerCtx.customer.id;
  } else if (body.draftRef) {
    const cookieToken = await readGuestDraftToken(body.draftRef);
    if (!cookieToken) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    const existing = await prisma.order.findUnique({ where: { draftRef: body.draftRef } });
    if (
      !existing ||
      existing.status !== "DRAFT" ||
      !(await verifyGuestToken(cookieToken, existing.guestTokenHash))
    ) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    customerId = existing.customerId;
    draftOrderId = existing.id;
  } else {
    if (!body.guest) {
      return NextResponse.json(
        { error: "Sign in or provide a name and email to save a draft" },
        { status: 401 },
      );
    }
    try {
      const { customer } = await findOrCreateGuestCustomer(body.guest);
      customerId = customer.id;
    } catch (error) {
      if (error instanceof VerifiedCustomerExistsError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }
    issuedGuestToken = generateGuestToken();
  }

  if (customerCtx && body.draftRef) {
    const existing = await prisma.order.findUnique({ where: { draftRef: body.draftRef } });
    // Anti-enumeration: another customer's draft ref is a 404, not a 403.
    if (!existing || existing.status !== "DRAFT" || existing.customerId !== customerId) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    draftOrderId = existing.id;
  }

  try {
    const order = await saveDraft({
      seasonId: season.id,
      customerId,
      draftOrderId,
      lines: body.lines.map((line) => ({ ...line, optionValueId: line.optionValueId ?? undefined })),
      recipients: body.recipients,
      guestToken: issuedGuestToken,
      allowBookWrites: Boolean(customerCtx),
    });
    const response = NextResponse.json({
      ok: true,
      draftRef: order.draftRef,
      orderId: order.id,
      totalCents: order.totalCents,
      version: order.version,
    });
    if (issuedGuestToken && order.draftRef) {
      writeGuestDraftTokenCookie(response, order.draftRef, issuedGuestToken);
    }
    return response;
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
