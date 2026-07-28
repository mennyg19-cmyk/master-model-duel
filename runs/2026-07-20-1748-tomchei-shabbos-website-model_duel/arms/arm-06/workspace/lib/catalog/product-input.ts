import { z } from "zod";
import { ProductKind } from "@prisma/client";
import { dollarsToCents } from "@/lib/money";

// Shared admin product payload (R-065). Prices arrive in dollars and convert
// to integer cents exactly once, here at the trust boundary.
export const productInputSchema = z.object({
  seasonId: z.string().min(1),
  name: z.string().min(1).max(200),
  slug: z.string().max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  kind: z.nativeEnum(ProductKind),
  basePriceDollars: z.coerce.number().nonnegative(),
  category: z.string().max(120).nullable().optional(),
  lengthMm: z.coerce.number().int().positive().nullable().optional(),
  widthMm: z.coerce.number().int().positive().nullable().optional(),
  heightMm: z.coerce.number().int().positive().nullable().optional(),
  weightGrams: z.coerce.number().int().positive().nullable().optional(),
  trackInventory: z.boolean(),
  allowBackorder: z.boolean(),
  active: z.boolean(),
  replacedById: z.string().nullable().optional(),
  addOnIds: z.array(z.string()).optional(),
});

export type ProductInput = z.infer<typeof productInputSchema>;

export function productScalars(input: ProductInput) {
  const basePriceCents = dollarsToCents(input.basePriceDollars);
  if (basePriceCents === null) {
    return { ok: false as const, error: "Price must be a clean dollar-and-cents amount" };
  }
  return {
    ok: true as const,
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      kind: input.kind,
      basePriceCents,
      category: input.category?.trim() || null,
      lengthMm: input.lengthMm ?? null,
      widthMm: input.widthMm ?? null,
      heightMm: input.heightMm ?? null,
      weightGrams: input.weightGrams ?? null,
      trackInventory: input.trackInventory,
      allowBackorder: input.allowBackorder,
      active: input.active,
      ...(input.replacedById !== undefined ? { replacedById: input.replacedById || null } : {}),
    },
  };
}
