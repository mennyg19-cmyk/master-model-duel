import { z } from "zod";
import { getOpenSeason } from "@/lib/season";
import { guardPublicEndpoint } from "@/lib/public-guard";
import { parseCart, resolveDraftOwner, findActiveDraft } from "@/lib/order-builder/draft-store";
import { buildCheckoutQuote } from "@/lib/checkout/quote";

const quoteSchema = z.object({
  choices: z.array(z.object({ recipientKey: z.string().min(1), methodId: z.string().min(1) })).max(200),
  deliveryDay: z.string().max(100).nullable().default(null),
});

/**
 * Live fee preview for the checkout page: given method choices, returns the
 * server-computed fee lines and errors (zip blocks, missing day). The page
 * never computes money client-side — this is the same engine checkout uses.
 */
export async function POST(request: Request) {
  const blocked = guardPublicEndpoint(request, "checkout-quote", 60, 60_000);
  if (blocked) return blocked;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "The store is closed" }, { status: 409 });

  const parsed = quoteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Quote payload is invalid" }, { status: 400 });

  const owner = await resolveDraftOwner();
  const draft = await findActiveDraft(season.id, owner);
  if (!draft) return Response.json({ error: "No active order draft" }, { status: 409 });

  const quote = await buildCheckoutQuote(
    season.id,
    parseCart(draft.cart),
    owner.kind === "customer" ? owner.customerId : null,
    parsed.data.choices,
    parsed.data.deliveryDay
  );
  if ("error" in quote) return Response.json({ error: quote.error }, { status: 409 });

  return Response.json({
    itemsCents: quote.priced.totalCents,
    issues: [
      ...quote.priced.issues,
      ...quote.priced.lines.flatMap((line) => line.issues.map((issue) => `${line.productName}: ${issue}`)),
    ],
    fees: quote.fees,
  });
}
