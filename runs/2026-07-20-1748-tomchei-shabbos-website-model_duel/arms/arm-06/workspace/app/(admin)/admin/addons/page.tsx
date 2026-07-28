import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AddonManager } from "@/app/(admin)/admin/addons/addon-manager";

export const metadata: Metadata = { title: "Add-ons" };
export const dynamic = "force-dynamic";

// R-066: add-on catalog management.
export default async function AdminAddonsPage() {
  await requirePermission("catalog.manage");

  const addOns = await prisma.addOn.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true } } },
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold">Add-ons</h1>
      <p className="mt-1 text-sm text-stone-600">
        Add-ons attach to products through each product&apos;s &ldquo;Allowed add-ons&rdquo; list.
      </p>
      <AddonManager
        addOns={addOns.map((addOn) => ({
          id: addOn.id,
          name: addOn.name,
          slug: addOn.slug,
          priceCents: addOn.priceCents,
          active: addOn.active,
          productCount: addOn._count.products,
        }))}
      />
    </div>
  );
}
