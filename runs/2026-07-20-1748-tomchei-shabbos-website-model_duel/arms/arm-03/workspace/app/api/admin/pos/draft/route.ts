import { db } from "@/lib/db";
import { getOpenSeason } from "@/lib/season";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { cartSchema, priceCart } from "@/lib/order-builder/cart";
import {
  posDraftOwner,
  findActiveDraft,
  saveDraft,
  applyAssignmentRules,
} from "@/lib/order-builder/draft-store";
import { getCustomerAddressBook } from "@/lib/addresses/book";

// POS builder autosave (UR-006 parity): the SAME response shape as the public
// /api/draft, so the shared OrderBuilder shell works unchanged — only the
// endpoint (staff-gated, keyed by an explicit customer) differs.

async function loadCustomer(customerId: string | null) {
  if (!customerId) return null;
  return db.customer.findUnique({ where: { id: customerId } });
}

export async function GET(request: Request) {
  const gate = await requirePermissionApi("orders.manage");
  if ("response" in gate) return gate.response;
  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "The store is closed" }, { status: 409 });

  const customer = await loadCustomer(new URL(request.url).searchParams.get("customerId"));
  if (!customer) return Response.json({ error: "Customer not found" }, { status: 404 });

  const addressBook = await getCustomerAddressBook(customer.id);
  const draft = await findActiveDraft(season.id, posDraftOwner(customer.id));
  if (!draft) return Response.json({ draft: null, addressBook });

  const cart = cartSchema.parse(draft.cart);
  const priced = await priceCart(season.id, cart);
  return Response.json({ draft: { updatedAt: draft.updatedAt, priced }, addressBook });
}

// PUT takes the raw cart body (identical to the public /api/draft) with the
// customer in the query string, so the shared builder only swaps the URL.
export async function PUT(request: Request) {
  const gate = await requirePermissionApi("orders.manage");
  if ("response" in gate) return gate.response;
  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "The store is closed" }, { status: 409 });

  const parsed = cartSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Cart payload is invalid" }, { status: 400 });

  const customer = await loadCustomer(new URL(request.url).searchParams.get("customerId"));
  if (!customer) return Response.json({ error: "Customer not found" }, { status: 404 });

  // Same rules as the web builder: new recipients land in the CUSTOMER's book.
  const cart = await applyAssignmentRules(parsed.data, customer.id);
  const draft = await saveDraft(season.id, posDraftOwner(customer.id), cart);
  const priced = await priceCart(season.id, cart);
  const addressBook = await getCustomerAddressBook(customer.id);
  return Response.json({ draft: { updatedAt: draft.updatedAt, priced }, addressBook });
}
