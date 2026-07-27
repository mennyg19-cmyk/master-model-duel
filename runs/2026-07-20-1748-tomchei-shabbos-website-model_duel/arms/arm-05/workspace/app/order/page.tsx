import { redirect } from "next/navigation";
import { getStorefront } from "@/lib/storefront";

export const dynamic = "force-dynamic";

export default async function OrderPage() {
  const { currentSeason } = await getStorefront();
  if (!currentSeason) redirect("/catalog");
  return (
    <main>
      <p className="eyebrow">{currentSeason.name}</p>
      <h1>Order building opens next.</h1>
      <p className="lead">The catalog is ready. Cart-first ordering arrives in P4.</p>
    </main>
  );
}
