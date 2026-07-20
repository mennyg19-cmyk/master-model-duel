import { z } from "zod";
import { getOpenSeason } from "@/lib/season";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { cartSchema } from "@/lib/order-builder/cart";
import { posDraftOwner, findActiveDraft } from "@/lib/order-builder/draft-store";
import { buildCheckoutQuote } from "@/lib/checkout/quote";

const quoteSchema = z.object({
  customerId: z.string().min(1),
  choices: z.array(z.object({ recipientKey: z.string(), methodId: z.string() })).nullable().default(null),
  deliveryDay: z.string().nullable().default(null),
});

/** POS checkout quote: the same fee/validation engine as web checkout (UR-006). */
export async function POST(request: Request) {
  const gate = await requirePermissionApi("orders.manage");
  if ("response" in gate) return gate.response;
  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "The store is closed" }, { status: 409 });

  const parsed = quoteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const draft = await findActiveDraft(season.id, posDraftOwner(parsed.data.customerId));
  if (!draft) return Response.json({ error: "No POS cart for this customer" }, { status: 404 });

  const quote = await buildCheckoutQuote(
    season.id,
    cartSchema.parse(draft.cart),
    parsed.data.customerId,
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
    recipients: quote.recipients.map((recipient) => ({
      key: recipient.key,
      recipientName: recipient.recipientName,
      cityZip: `${recipient.address.city} ${recipient.address.zip}`,
      rememberedGreeting: recipient.rememberedGreeting,
    })),
    methods: quote.methods,
    purimDayChoices: quote.config.purimDayChoices,
    fees: quote.fees,
  });
}
