import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOpenSeason } from "@/lib/seasons/queries";
import { ProductForm } from "@/app/(admin)/admin/products/product-form";

export const metadata: Metadata = { title: "New product" };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  await requirePermission("catalog.manage");

  const [seasons, openSeason, addOns] = await Promise.all([
    prisma.season.findMany({ orderBy: { name: "desc" } }),
    getOpenSeason(),
    prisma.addOn.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <Link href="/admin/products" className="text-sm text-brand-700 hover:underline">
        ← Products
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">New product</h1>
      <ProductForm
        mode="create"
        seasons={seasons}
        replacementOptions={[]}
        addOnOptions={addOns}
        initial={{
          id: "",
          seasonId: openSeason?.id ?? seasons[0]?.id ?? "",
          name: "",
          description: null,
          kind: "GOOD",
          basePriceDollars: "0.00",
          category: null,
          lengthMm: null,
          widthMm: null,
          heightMm: null,
          weightGrams: null,
          trackInventory: false,
          allowBackorder: false,
          active: true,
          replacedById: null,
          addOnIds: [],
        }}
      />
    </div>
  );
}
