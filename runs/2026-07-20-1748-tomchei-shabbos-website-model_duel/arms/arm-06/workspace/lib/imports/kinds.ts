import { ImportKind } from "@prisma/client";
import { Permission } from "@/lib/permissions";
import { KindHandler } from "@/lib/imports/engine";
import { customersImport } from "@/lib/imports/customers";
import { productsImport } from "@/lib/imports/products";
import { legacyCustomersImport } from "@/lib/imports/legacy/customers";
import { legacyProductsImport } from "@/lib/imports/legacy/products";
import { legacyOrdersImport } from "@/lib/imports/legacy/orders";

// One registry so the stage/preview/commit/discard routes can never disagree
// about which permission or handler a kind uses.
export const IMPORT_PERMISSION: Record<ImportKind, Permission> = {
  CUSTOMERS: "customers.manage",
  PRODUCTS: "catalog.manage",
  LEGACY_CUSTOMERS: "customers.manage",
  LEGACY_PRODUCTS: "catalog.manage",
  LEGACY_ORDERS: "payments.manage",
};

export const IMPORT_HANDLERS: Record<ImportKind, KindHandler> = {
  CUSTOMERS: customersImport,
  PRODUCTS: productsImport,
  LEGACY_CUSTOMERS: legacyCustomersImport,
  LEGACY_PRODUCTS: legacyProductsImport,
  LEGACY_ORDERS: legacyOrdersImport,
};

// Display labels for the kind enum, one home for every import surface. The
// upload form's "(old system)" hint is applied at its call site, not forked
// into a second map.
export const KIND_LABEL: Record<ImportKind, string> = {
  CUSTOMERS: "Customers",
  PRODUCTS: "Products",
  LEGACY_CUSTOMERS: "Legacy customers",
  LEGACY_PRODUCTS: "Legacy products",
  LEGACY_ORDERS: "Legacy orders",
};
