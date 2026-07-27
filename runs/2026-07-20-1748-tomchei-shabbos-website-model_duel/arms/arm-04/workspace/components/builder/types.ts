// Client-side view types for the order builder. Types only — the server
// modules these mirror (lib/order-builder/cart.ts) import Prisma and can't be
// bundled into client components.
import type { Cart, CartLine, PricedCart, BuilderCatalog } from "@/lib/order-builder/cart";

export type { Cart, CartLine, PricedCart, BuilderCatalog };

export type BuilderProduct = BuilderCatalog["products"][number];
export type BuilderAddOn = BuilderCatalog["addOns"][number];

export type SavedAddress = {
  id: string;
  label: string | null;
  recipient: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
};

export type LiveStock = {
  products: { id: string; soldOut: boolean; available: number | null }[];
  addOns: { id: string; available: number | null }[];
};

export function emptyCart(): Cart {
  return { onOrderRecipient: null, lines: [] };
}
