import { DraftRecipient, Order, OrderLine, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { claimDraftRef } from "@/lib/orders/numbers";
import {
  DraftLineInput,
  insertResolvedLines,
  resolveDraftLines,
} from "@/lib/orders/resolve-lines";
import { hashGuestToken, verifyGuestToken } from "@/lib/orders/guest-token";
import { saveAddress } from "@/lib/customers/addresses";
import { releaseOrderReservation } from "@/lib/checkout/reservations";

// P4 draft engine: save (create-or-replace), load, and cancel web drafts with
// recipient assignment + address-book autosave. Ownership is enforced here
// AND in the routes: customer-session drafts match on customerId, guest
// drafts on the token hash — a miss is always null/404, never 403, so the
// existence of a draft ref is never leaked (anti-enumeration, R-023/R-121).

export interface DraftRecipientInput {
  /** Caller-generated id that lines reference via recipientClientId. */
  clientId: string;
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postalCode: string;
  country?: string;
  /** Book row this recipient came from (address-book pick). Verified to
   *  belong to the ordering customer. */
  addressId?: string | null;
  /** New recipient: auto-save the address to the customer's book (G-019). */
  saveToBook?: boolean;
  /** Book label when saveToBook is set. */
  label?: string | null;
}

export type DraftWithContents = Order & { lines: OrderLine[]; recipients: DraftRecipient[] };

// Shared with create-draft.ts — both draft engines gate on the same
// open-season rule inside their transactions, so the wording lives once.
export async function assertOpenSeason(tx: Prisma.TransactionClient, seasonId: string) {
  const season = await tx.season.findUnique({ where: { id: seasonId } });
  if (!season) throw new NotFoundError("Season", seasonId);
  if (season.status !== "OPEN") {
    throw new DomainRuleError(`Season ${season.name} is closed; expected OPEN to accept orders`);
  }
  return season;
}

async function writeRecipients(
  tx: Prisma.TransactionClient,
  orderId: string,
  customerId: string,
  recipients: DraftRecipientInput[],
  allowBookWrites: boolean,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const seen = new Set<string>();

  for (const recipient of recipients) {
    if (!recipient.clientId || seen.has(recipient.clientId)) {
      throw new DomainRuleError(`Duplicate or missing recipient clientId: ${recipient.clientId}`);
    }
    seen.add(recipient.clientId);
    if (!recipient.name.trim()) throw new DomainRuleError("Recipient name is required");

    let addressId = recipient.addressId ?? null;
    if (addressId) {
      const bookRow = await tx.address.findUnique({ where: { id: addressId } });
      if (!bookRow || bookRow.customerId !== customerId) {
        throw new DomainRuleError("Saved address does not belong to this customer");
      }
    } else if (recipient.saveToBook && allowBookWrites) {
      const { address } = await saveAddress(
        customerId,
        {
          label: recipient.label ?? recipient.name,
          line1: recipient.line1,
          line2: recipient.line2 ?? null,
          city: recipient.city,
          region: recipient.region,
          postalCode: recipient.postalCode,
          country: recipient.country ?? "US",
        },
        tx,
      );
      addressId = address.id;
    }

    const row = await tx.draftRecipient.create({
      data: {
        orderId,
        name: recipient.name.trim(),
        line1: recipient.line1,
        line2: recipient.line2 ?? null,
        city: recipient.city,
        region: recipient.region,
        postalCode: recipient.postalCode,
        country: recipient.country ?? "US",
        addressId,
      },
    });
    ids.set(recipient.clientId, row.id);
  }
  return ids;
}

function assertRecipientReferences(lines: DraftLineInput[], recipients: DraftRecipientInput[]): void {
  const known = new Set(recipients.map((recipient) => recipient.clientId));
  for (const line of lines) {
    if (line.recipientClientId && !known.has(line.recipientClientId)) {
      throw new DomainRuleError(`Line references unknown recipient ${line.recipientClientId}`);
    }
  }
}

// Create-or-replace: an existing draft's lines + recipients are swapped for
// the new contents in one transaction (price snapshots refresh on every save;
// stale-price refusal at payment time lives in checkout validation). An empty
// lines array is a full clear — the emptied-cart autosave persists here
// instead of silently keeping the stale lines. `allowBookWrites` gates
// saveToBook: only verified customer sessions may write to an address book.
export async function saveDraft(input: {
  seasonId: string;
  customerId: string;
  draftOrderId?: string;
  lines: DraftLineInput[];
  recipients: DraftRecipientInput[];
  guestToken?: string;
  allowBookWrites: boolean;
}): Promise<DraftWithContents> {
  const recipients = input.lines.length === 0 ? [] : input.recipients;
  assertRecipientReferences(input.lines, recipients);

  return prisma.$transaction(async (tx) => {
    const season = await assertOpenSeason(tx, input.seasonId);

    let order: Order;
    if (input.draftOrderId) {
      const existing = await tx.order.findUnique({ where: { id: input.draftOrderId } });
      if (!existing || existing.status !== "DRAFT" || existing.customerId !== input.customerId) {
        throw new NotFoundError("Draft", input.draftOrderId);
      }
      // Editing after checkout started returns the reservation and kills the
      // session — the rewritten draft must re-submit before it can pay.
      await releaseOrderReservation(tx, existing.id);
      await tx.orderLine.deleteMany({ where: { orderId: existing.id } });
      await tx.draftRecipient.deleteMany({ where: { orderId: existing.id } });
      order = existing;
    } else {
      const draftRef = await claimDraftRef(tx, season.id, season.name);
      order = await tx.order.create({
        data: {
          seasonId: season.id,
          customerId: input.customerId,
          draftRef,
          ...(input.guestToken ? { guestTokenHash: await hashGuestToken(input.guestToken) } : {}),
        },
      });
    }

    const recipientIds = await writeRecipients(tx, order.id, input.customerId, recipients, input.allowBookWrites);
    const resolved = input.lines.length === 0 ? [] : await resolveDraftLines(tx, input.lines);
    await insertResolvedLines(tx, order.id, resolved, recipientIds);

    const totalCents = resolved.reduce((sum, line) => sum + line.lineTotalCents, 0);
    return tx.order.update({
      where: { id: order.id },
      // Rewritten contents invalidate any prior checkout submit (fees and
      // greeting default were frozen against the old lines).
      data: { totalCents, deliveryFeesCents: 0, greetingDefault: null, version: { increment: 1 } },
      include: { lines: true, recipients: true },
    });
  });
}

export interface DraftAccess {
  /** Authenticated customer's id (session path). */
  customerId?: string;
  /** Raw guest token (guest path). */
  guestToken?: string;
  /**
   * P6 POS: staff act on behalf of a customer at the counter. Only set
   * server-side after a requirePermission("payments.manage") gate — never
   * from request input.
   */
  staff?: boolean;
}

// Exported for the P5 checkout engine — every draft/order route runs the
// same ownership check (session match, guest token hash, or the gated
// staff override).
export async function canAccess(order: Order, access: DraftAccess): Promise<boolean> {
  if (access.staff) return true;
  if (access.customerId && order.customerId === access.customerId) return true;
  if (access.guestToken) return verifyGuestToken(access.guestToken, order.guestTokenHash);
  return false;
}

// Null on any miss — the route turns it into a flat 404 either way.
export async function loadDraft(draftRef: string, access: DraftAccess): Promise<DraftWithContents | null> {
  const order = await prisma.order.findUnique({
    where: { draftRef },
    include: { lines: true, recipients: true },
  });
  if (!order || order.status !== "DRAFT") return null;
  if (!(await canAccess(order, access))) return null;
  return order;
}

// Checkout needs every status: DRAFT renders the summary, FINALIZED is the
// success state that clears the guest's local draft copy, DISCARDED explains
// itself. Ownership is still session-or-token, still 404-on-miss.
export async function loadOrderForCheckout(
  draftRef: string,
  access: DraftAccess,
): Promise<DraftWithContents | null> {
  const order = await prisma.order.findUnique({
    where: { draftRef },
    include: { lines: true, recipients: true },
  });
  if (!order) return null;
  if (!(await canAccess(order, access))) return null;
  return order;
}

// R-040: cancel = DISCARDED (terminal in the P2 state machine). A
// checkout-started draft releases its stock reservation on the way out.
export async function cancelDraft(draftRef: string, access: DraftAccess): Promise<boolean> {
  const order = await prisma.order.findUnique({ where: { draftRef } });
  if (!order || order.status !== "DRAFT") return false;
  if (!(await canAccess(order, access))) return false;
  await prisma.$transaction(async (tx) => {
    await releaseOrderReservation(tx, order.id);
    await tx.order.update({ where: { id: order.id }, data: { status: "DISCARDED" } });
  });
  return true;
}
