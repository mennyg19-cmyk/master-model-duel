// Shared types for the cart-first order builder (R-019). The same shapes
// drive the storefront builder and, in P6, the POS — the shell is the shared
// surface (R-031), the viewer/checkout wiring is the context that differs.

export interface BuilderOptionValue {
  id: string;
  label: string;
  priceDeltaCents: number;
}

export interface BuilderOption {
  id: string;
  name: string;
  values: BuilderOptionValue[];
}

export interface BuilderAddOn {
  id: string;
  name: string;
  priceCents: number;
}

export interface BuilderProduct {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  basePriceCents: number;
  imageUrl: string | null;
  /** null = untracked (no ceiling); tracked products show live availability. */
  stock: number | null;
  soldOut: boolean;
  allowBackorder: boolean;
  options: BuilderOption[];
  /** Restricted add-ons already filtered to what this product allows (R-021). */
  addOns: BuilderAddOn[];
}

/** The pricing slice of BuilderProduct the totals math reads. */
export type PricedProduct = Pick<BuilderProduct, "basePriceCents" | "options" | "addOns">;

export interface BookAddress {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  summary: string;
}

/** Three-way recipient source (UR-006/G-018): reuse one already on this
 *  order, pick from the address book, or enter a brand-new recipient. */
export type RecipientSource = "on-order" | "book" | "new";

export interface RecipientState {
  clientId: string;
  source: RecipientSource;
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  /** Book row this recipient came from (book source) or auto-saved to (new). */
  addressId: string | null;
  /** New recipients default to auto-saving into the customer's book (G-019). */
  saveToBook: boolean;
  label: string | null;
}

export interface CartLine {
  clientId: string;
  productId: string;
  optionValueId: string | null;
  qty: number;
  addOnIds: string[];
  recipientClientId: string | null;
}

export interface DraftState {
  lines: CartLine[];
  recipients: RecipientState[];
}

export interface ViewerContext {
  kind: "customer" | "guest";
  name?: string;
  email?: string;
}

/**
 * P6 POS wiring (R-031): the shell keeps one code path; the POS swaps the
 * save endpoint, the checkout destination, and injects the counter customer
 * into every save body. Undefined = the storefront behavior, untouched.
 */
export interface PosConfig {
  customerId: string;
  saveUrl: string;
  checkoutUrl: string;
}
