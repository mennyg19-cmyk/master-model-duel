import { getOpenSeason } from "@/lib/season";
import { getBuilderCatalog } from "@/lib/order-builder/cart";

// Live stock for the builder (R-020): the client refetches this after cart
// changes so availability reflects reservations made by other checkouts.
export async function GET() {
  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "The store is closed" }, { status: 409 });
  const catalog = await getBuilderCatalog(season.id);
  return Response.json({
    products: catalog.products.map((product) => ({
      id: product.id,
      soldOut: product.soldOut,
      available: product.available,
    })),
    addOns: catalog.addOns.map((addOn) => ({ id: addOn.id, available: addOn.available })),
  });
}
