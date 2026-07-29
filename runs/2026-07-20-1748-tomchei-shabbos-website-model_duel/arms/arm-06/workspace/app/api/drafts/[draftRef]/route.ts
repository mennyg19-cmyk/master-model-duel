import { NextResponse } from "next/server";
import { cancelDraft, loadDraft } from "@/lib/orders/drafts";
import { getCustomerContext } from "@/lib/customers/session";
import { readGuestDraftToken } from "@/lib/orders/guest-draft-cookie";
import { assertSameOrigin } from "@/lib/public-guard";
import { clientIp } from "@/lib/client-ip";
import { draftSaveRateLimit } from "@/lib/rate-limit";

// R-022/R-040: load or cancel one draft. Ownership: customer session match or
// the draft's guest cookie (httpOnly — the token never travels in URLs).
// Every miss is 404 — never 403 — so draft refs can't be enumerated
// (R-023/R-121).
async function accessFrom(draftRef: string) {
  const customerCtx = await getCustomerContext();
  const guestToken = await readGuestDraftToken(draftRef);
  return { customerId: customerCtx?.customer.id, guestToken };
}

function draftPayload(order: NonNullable<Awaited<ReturnType<typeof loadDraft>>>) {
  return {
    draftRef: order.draftRef,
    status: order.status,
    totalCents: order.totalCents,
    version: order.version,
    recipients: order.recipients.map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      line1: recipient.line1,
      line2: recipient.line2,
      city: recipient.city,
      region: recipient.region,
      postalCode: recipient.postalCode,
      country: recipient.country,
      addressId: recipient.addressId,
    })),
    lines: order.lines.map((line) => ({
      id: line.id,
      parentLineId: line.parentLineId,
      recipientId: line.recipientId,
      productId: line.productId,
      addOnId: line.addOnId,
      productName: line.productName,
      qty: line.qty,
      unitPriceCents: line.unitPriceCents,
      optionValueId: line.optionValueId,
      optionLabel: line.optionLabel,
      lineTotalCents: line.lineTotalCents,
    })),
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ draftRef: string }> }) {
  const { draftRef } = await params;
  const order = await loadDraft(draftRef, await accessFrom(draftRef));
  if (!order) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  return NextResponse.json({ ok: true, draft: draftPayload(order) });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ draftRef: string }> }) {
  // Cancel releases the stock reservation — a public mutation, so it carries
  // the same-origin + rate-limit guards like every other one (R-122).
  const originBlock = assertSameOrigin(request);
  if (originBlock) return originBlock;
  if (!draftSaveRateLimit(clientIp(request.headers) ?? "unknown")) {
    return NextResponse.json({ error: "Too many saves; wait a moment and try again" }, { status: 429 });
  }
  const { draftRef } = await params;
  const cancelled = await cancelDraft(draftRef, await accessFrom(draftRef));
  if (!cancelled) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
