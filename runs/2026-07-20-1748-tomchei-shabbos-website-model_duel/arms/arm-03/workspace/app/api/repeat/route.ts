import { z } from "zod";
import { getOpenSeason } from "@/lib/season";
import { getCustomerContext } from "@/lib/auth/customer-session";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import {
  loadRepeatableOrder,
  buildRepeatPlan,
  buildRepeatCartLines,
  appendRepeatToCustomerDraft,
} from "@/lib/repeat";

const confirmSchema = z.object({
  orderId: z.string().min(1),
  decisions: z
    .array(
      z.object({
        lineId: z.string().min(1),
        productId: z.string().min(1).nullable(),
        keepRecipient: z.boolean().default(true),
      })
    )
    .min(1)
    .max(300),
});

/**
 * Customer repeat confirm (UR-007): the review page posts one decision per
 * prior line. The server rebuilds the plan and re-validates every pick against
 * the OPEN season — the client's mapping display is never trusted. Lines land
 * appended to the customer's active draft; recipients auto-save to the address
 * book on draft save (G-012).
 */
export async function POST(request: Request) {
  if (!rateLimit(`repeat:${clientIp(request)}`, 20, 60_000)) {
    return Response.json({ error: "Too many repeat attempts — slow down a moment." }, { status: 429 });
  }
  const customer = await getCustomerContext();
  if (!customer) return Response.json({ error: "Sign in to repeat an order" }, { status: 401 });

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "The store is closed" }, { status: 409 });

  const parsed = confirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Repeat payload is invalid" }, { status: 400 });

  const order = await loadRepeatableOrder(parsed.data.orderId);
  // A foreign or unknown order id answers identically (R-121 anti-probing).
  if (!order || order.customerId !== customer.id || order.status !== "FINALIZED") {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }

  const plan = await buildRepeatPlan(order, season);
  const built = buildRepeatCartLines(plan, parsed.data.decisions);
  if (!built.ok) return Response.json({ error: built.error }, { status: 400 });
  if (built.cartLines.length === 0) {
    return Response.json({ error: "Every item was removed — nothing to repeat" }, { status: 400 });
  }

  await appendRepeatToCustomerDraft(season.id, customer.id, built.cartLines);
  return Response.json({ ok: true, added: built.cartLines.length, unassigned: built.unassigned });
}
