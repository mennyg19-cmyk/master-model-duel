import { ImportKind } from "@prisma/client";
import { Permission } from "@/lib/permissions";
import { KindHandler } from "@/lib/imports/engine";
import { customersImport } from "@/lib/imports/customers";
import { productsImport } from "@/lib/imports/products";

// One registry so the stage/preview/commit/discard routes can never disagree
// about which permission or handler a kind uses.
export const IMPORT_PERMISSION: Record<ImportKind, Permission> = {
  CUSTOMERS: "customers.manage",
  PRODUCTS: "catalog.manage",
};

export const IMPORT_HANDLERS: Record<ImportKind, KindHandler> = {
  CUSTOMERS: customersImport,
  PRODUCTS: productsImport,
};
