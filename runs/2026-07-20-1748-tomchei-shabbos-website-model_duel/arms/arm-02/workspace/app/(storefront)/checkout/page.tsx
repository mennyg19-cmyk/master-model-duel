import { redirect } from "next/navigation";

/**
 * Checkout ships in P5. Until then the route funnels into /order, which owns
 * the server-side season gate (R-002) — no checkout UI is reachable while the
 * store is closed.
 */
export default function CheckoutPage() {
  redirect("/order");
}
