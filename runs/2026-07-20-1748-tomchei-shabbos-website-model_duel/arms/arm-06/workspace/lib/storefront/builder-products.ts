import { prisma } from "@/lib/db";
import { availableStock, catalogProductInclude, isSoldOut } from "@/lib/storefront/catalog";
import { BookAddress, BuilderProduct } from "@/components/order-builder/types";
import { addressSummary } from "@/lib/customers/addresses";

// The builder's product slice — storefront order page and POS mount the same
// shell against the same live catalog+stock view (R-020/R-031), so the query
// and its mapping live once here.
export async function loadBuilderProducts(seasonId: string): Promise<BuilderProduct[]> {
  const products = await prisma.product.findMany({
    where: { seasonId, active: true },
    include: catalogProductInclude,
    orderBy: { name: "asc" },
  });

  return products.map((product) => ({
    id: product.id,
    slug: product.slug,
    name: product.name,
    category: product.category,
    description: product.description,
    basePriceCents: product.basePriceCents,
    imageUrl: product.media[0]?.url ?? null,
    stock: availableStock(product),
    soldOut: isSoldOut(product),
    allowBackorder: product.allowBackorder,
    options: product.options.map((option) => ({
      id: option.id,
      name: option.name,
      values: option.values.map((value) => ({
        id: value.id,
        label: value.label,
        priceDeltaCents: value.priceDeltaCents,
      })),
    })),
    addOns: product.allowedAddOns
      .map((restriction) => restriction.addOn)
      .filter((addOn) => addOn.active)
      .map((addOn) => ({ id: addOn.id, name: addOn.name, priceCents: addOn.priceCents })),
  }));
}

export async function loadBookAddresses(customerId: string): Promise<BookAddress[]> {
  const addresses = await prisma.address.findMany({
    where: { customerId },
    orderBy: [{ label: "asc" }, { createdAt: "asc" }],
  });
  return addresses.map((address) => ({
    id: address.id,
    label: address.label,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
    country: address.country,
    summary: addressSummary(address),
  }));
}
