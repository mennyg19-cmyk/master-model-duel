import { DraftWithContents } from "@/lib/orders/drafts";

// Shared mapping from a loaded draft to the checkout form's recipient props —
// the storefront checkout and the P6 POS checkout render the same per-recipient
// choices UI, so the line/add-on rollup lives exactly once.
export interface CheckoutRecipientProps {
  id: string;
  name: string;
  addressLine: string;
  line1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  rememberedGreeting: string | null;
  initialChoice: string | null;
  initialDeliveryDay: string | null;
  initialGreeting: string | null;
  lines: { id: string; label: string; addOns: string[]; lineTotalCents: number }[];
}

export function buildCheckoutRecipients(
  order: DraftWithContents,
  rememberedGreetings: Map<string, string | null>,
): { recipients: CheckoutRecipientProps[]; unassignedCount: number; subtotalCents: number } {
  const productLines = order.lines.filter((line) => line.productId !== null);
  const addOnLines = order.lines.filter((line) => line.addOnId !== null);

  const recipients = order.recipients.map((recipient) => ({
    id: recipient.id,
    name: recipient.name,
    addressLine: `${recipient.line1}${recipient.line2 ? `, ${recipient.line2}` : ""}, ${recipient.city}, ${recipient.region} ${recipient.postalCode}`,
    line1: recipient.line1,
    city: recipient.city,
    region: recipient.region,
    postalCode: recipient.postalCode,
    country: recipient.country,
    rememberedGreeting: recipient.addressId ? (rememberedGreetings.get(recipient.addressId) ?? null) : null,
    initialChoice: recipient.fulfillmentChoice,
    initialDeliveryDay: recipient.deliveryDay,
    initialGreeting: recipient.greeting,
    lines: productLines
      .filter((line) => line.recipientId === recipient.id)
      .map((line) => ({
        id: line.id,
        label: `${line.qty} × ${line.productName}${line.optionLabel ? ` (${line.optionLabel})` : ""}`,
        addOns: addOnLines
          .filter((addOn) => addOn.parentLineId === line.id)
          .map((addOn) => `${addOn.qty} × ${addOn.productName}`),
        lineTotalCents:
          line.lineTotalCents +
          addOnLines
            .filter((addOn) => addOn.parentLineId === line.id)
            .reduce((sum, addOn) => sum + addOn.lineTotalCents, 0),
      })),
  }));

  return {
    recipients,
    unassignedCount: productLines.filter((line) => !line.recipientId).length,
    subtotalCents: order.lines.reduce((sum, line) => sum + line.lineTotalCents, 0),
  };
}
