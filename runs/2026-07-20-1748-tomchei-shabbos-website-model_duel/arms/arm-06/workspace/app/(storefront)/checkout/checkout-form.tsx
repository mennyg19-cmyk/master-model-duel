"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { dollarsToCents, formatCents } from "@/lib/money";
import { isDeliverable, normalizePostalCode } from "@/lib/storefront/delivery";
import { bulkAddressKey } from "@/lib/checkout/fulfillment";
import { CheckoutRecipientProps } from "@/lib/checkout/recipient-props";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type Choice = "PICKUP" | "BULK_DELIVERY" | "PER_PACKAGE_DELIVERY" | "SHIPPED";
type PosMethod = "cash" | "check";

export type ShippingQuoteProp =
  | { available: true; chargedCents: number; serviceLabel: string }
  | { available: false; reason: string };

interface ConflictReport {
  priceConflicts: { productName: string; storedCents: number; freshCents: number }[];
  stockIssues: { productName: string; requested: number; available: number }[];
  freshTotalCents: number;
}

const CHOICE_LABELS: Record<Choice, string> = {
  PICKUP: "Pickup (free)",
  BULK_DELIVERY: "Bulk delivery",
  PER_PACKAGE_DELIVERY: "Per-package delivery",
  SHIPPED: "Carrier shipping",
};

// The client mirrors the server's fee math for display only — the server
// recomputes everything on submit and a mismatch is a 409 conflict.
export function CheckoutForm({
  draftRef,
  greetingDefault,
  subtotalCents,
  feeRules,
  deliveryDays,
  deliveryZips,
  recipients,
  unassignedCount,
  builderHref,
  pos,
  shippingQuotes,
}: {
  draftRef: string;
  greetingDefault: string | null;
  subtotalCents: number;
  feeRules: { bulkPerDestinationCents: number; perPackagePerRecipientCents: number };
  deliveryDays: string[];
  deliveryZips: string[];
  recipients: CheckoutRecipientProps[];
  unassignedCount: number;
  /** P8 live Shippo display quotes per recipient (server-quoted at page load). */
  shippingQuotes: Record<string, ShippingQuoteProp>;
  /** Back-to-builder link when lines are unassigned (defaults to storefront). */
  builderHref?: string;
  /** P6 POS: one-click counter checkout — submit + finalize + post offline
   *  payment in a single staff-gated call instead of the Stripe handoff. */
  pos?: { completeUrl: string; orderHref: (orderId: string) => string };
}) {
  const router = useRouter();
  const [choices, setChoices] = useState<Record<string, Choice>>(
    Object.fromEntries(
      recipients.map((recipient) => [
        recipient.id,
        (recipient.initialChoice as Choice | null) ?? "PICKUP",
      ]),
    ),
  );
  const [days, setDays] = useState<Record<string, string>>(
    Object.fromEntries(
      recipients.map((recipient) => [recipient.id, recipient.initialDeliveryDay ?? deliveryDays[0] ?? ""]),
    ),
  );
  const [greetings, setGreetings] = useState<Record<string, string>>(
    Object.fromEntries(
      recipients.map((recipient) => [
        recipient.id,
        recipient.initialGreeting ?? recipient.rememberedGreeting ?? "",
      ]),
    ),
  );
  const [orderGreeting, setOrderGreeting] = useState(greetingDefault ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictReport | null>(null);
  const [paymentUnavailable, setPaymentUnavailable] = useState<string | null>(null);
  const [posMethod, setPosMethod] = useState<PosMethod>("cash");
  const [posAmount, setPosAmount] = useState<string | null>(null);

  // Bulk dedupe mirror: first recipient on a shared address carries the fee.
  // The key IS the server's bulkAddressKey on the same structured fields, so
  // the displayed total can never drift from the server's frozen total.
  const { feesByRecipient, feesCents, totalCents } = useMemo(() => {
    const seen = new Set<string>();
    const feesByRecipient: Record<string, number> = {};
    for (const recipient of recipients) {
      const choice = choices[recipient.id] ?? "PICKUP";
      let fee = 0;
      if (choice === "BULK_DELIVERY") {
        const key = bulkAddressKey(recipient);
        if (!seen.has(key)) fee = feeRules.bulkPerDestinationCents;
        seen.add(key);
      } else if (choice === "PER_PACKAGE_DELIVERY") {
        fee = feeRules.perPackagePerRecipientCents;
      } else if (choice === "SHIPPED") {
        const quote = shippingQuotes[recipient.id];
        if (quote?.available) fee = quote.chargedCents;
      }
      feesByRecipient[recipient.id] = fee;
    }
    const feesCents = Object.values(feesByRecipient).reduce((sum, fee) => sum + fee, 0);
    return { feesByRecipient, feesCents, totalCents: subtotalCents + feesCents };
  }, [choices, recipients, feeRules, subtotalCents, shippingQuotes]);

  function perPackageBlocked(recipient: CheckoutRecipientProps): boolean {
    return !isDeliverable(deliveryZips, recipient.postalCode);
  }

  function checkoutBody() {
    return {
      draftRef,
      greetingDefault: orderGreeting || null,
      expectedTotalCents: totalCents,
      recipients: recipients.map((recipient) => ({
        recipientId: recipient.id,
        fulfillmentChoice: choices[recipient.id] ?? "PICKUP",
        deliveryDay:
          (choices[recipient.id] ?? "PICKUP") === "PER_PACKAGE_DELIVERY"
            ? days[recipient.id] || null
            : null,
        greeting: greetings[recipient.id] || null,
      })),
    };
  }

  // POS: one staff call submits checkout, finalizes, and posts cash/check.
  async function completePosSale() {
    if (!pos) return;
    setIsSubmitting(true);
    setError(null);
    setConflict(null);

    const amountCents = posAmount === null ? totalCents : dollarsToCents(Number(posAmount));
    if (amountCents === null) {
      setIsSubmitting(false);
      setError("Amount must be a clean dollar-and-cents amount");
      return;
    }
    const result = await apiFetch<{ conflict?: ConflictReport; orderId?: string }>(pos.completeUrl, {
      method: "POST",
      body: { ...checkoutBody(), method: posMethod, amountCents },
    });
    setIsSubmitting(false);
    if (!result.ok || !result.body.orderId) {
      if (result.status === 409 && result.body.conflict) {
        setConflict(result.body.conflict);
      } else {
        setError(result.body.error ?? "Could not complete the sale");
      }
      return;
    }
    router.push(pos.orderHref(result.body.orderId));
  }

  async function submitAndPay() {
    setIsSubmitting(true);
    setError(null);
    setConflict(null);
    setPaymentUnavailable(null);

    const submit = await apiFetch<{ conflict?: ConflictReport }>("/api/checkout/submit", {
      method: "POST",
      body: checkoutBody(),
    });
    if (!submit.ok) {
      setIsSubmitting(false);
      if (submit.status === 409 && submit.body.conflict) {
        setConflict(submit.body.conflict);
      } else {
        setError(submit.body.error ?? "Checkout failed — please try again");
      }
      return;
    }

    const pay = await apiFetch<{ checkoutUrl?: string }>("/api/checkout/pay", {
      method: "POST",
      body: { draftRef },
    });
    setIsSubmitting(false);
    if (!pay.ok) {
      if (pay.status === 503) {
        // Documented seam: no live Stripe keys on this host. The submit above
        // still froze the order — nothing here is a fake paid state.
        setPaymentUnavailable(pay.body.error ?? "Card payment is not configured yet");
      } else {
        setError(pay.body.error ?? "Could not start card payment");
      }
      return;
    }
    window.location.href = pay.body.checkoutUrl!;
  }

  return (
    <div>
      <ul className="mt-6 flex flex-col gap-4" data-checkout-summary>
        {recipients.map((recipient) => {
          const choice = choices[recipient.id] ?? "PICKUP";
          const blocked = perPackageBlocked(recipient);
          const shippingQuote = shippingQuotes[recipient.id];
          return (
            <li
              key={recipient.id}
              className="rounded-lg border border-stone-200 p-4"
              data-checkout-recipient={recipient.name}
            >
              <h2 className="font-semibold text-stone-900">{recipient.name}</h2>
              <p className="text-sm text-stone-500">{recipient.addressLine}</p>
              <ul className="mt-2 flex flex-col gap-1">
                {recipient.lines.map((line) => (
                  <li key={line.id} className="flex justify-between text-sm text-stone-700">
                    <span>
                      {line.label}
                      {line.addOns.length > 0 ? ` (+${line.addOns.join(", ")})` : ""}
                    </span>
                    <span>{formatCents(line.lineTotalCents)}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor={`choice-${recipient.id}`}>Fulfillment</Label>
                  <Select
                    id={`choice-${recipient.id}`}
                    className="mt-1 w-full"
                    value={choice}
                    onChange={(event) =>
                      setChoices((prev) => ({ ...prev, [recipient.id]: event.target.value as Choice }))
                    }
                    data-fulfillment-choice={recipient.id}
                  >
                    {(Object.keys(CHOICE_LABELS) as Choice[]).map((option) => {
                      const optionBlocked =
                        (option === "PER_PACKAGE_DELIVERY" && blocked) ||
                        (option === "SHIPPED" && shippingQuote?.available === false);
                      return (
                        <option key={option} value={option} disabled={optionBlocked}>
                          {CHOICE_LABELS[option]}
                          {option === "BULK_DELIVERY" ? ` (${formatCents(feeRules.bulkPerDestinationCents)}/destination)` : ""}
                          {option === "PER_PACKAGE_DELIVERY"
                            ? ` (${formatCents(feeRules.perPackagePerRecipientCents)})${blocked ? " — unavailable here" : ""}`
                            : ""}
                          {option === "SHIPPED" && shippingQuote?.available === true
                            ? ` (${formatCents(shippingQuote.chargedCents)})`
                            : ""}
                          {option === "SHIPPED" && shippingQuote?.available === false ? " — unavailable" : ""}
                        </option>
                      );
                    })}
                  </Select>
                  {choice === "PER_PACKAGE_DELIVERY" && blocked && (
                    <p className="mt-1 text-sm text-red-700" data-zip-blocked={recipient.id}>
                      {normalizePostalCode(recipient.postalCode)} is outside the per-package delivery
                      area — pickup or bulk delivery only.
                    </p>
                  )}
                  {choice === "PER_PACKAGE_DELIVERY" && !blocked && (
                    <div className="mt-2">
                      <Label htmlFor={`day-${recipient.id}`}>Delivery day</Label>
                      <Select
                        id={`day-${recipient.id}`}
                        className="mt-1 w-full"
                        value={days[recipient.id] ?? ""}
                        onChange={(event) =>
                          setDays((prev) => ({ ...prev, [recipient.id]: event.target.value }))
                        }
                        data-delivery-day={recipient.id}
                      >
                        {deliveryDays.map((day) => (
                          <option key={day} value={day}>
                            {day}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                  {choice === "SHIPPED" && shippingQuote?.available === true && (
                    <p className="mt-1 text-sm text-stone-600" data-shipping-quote={recipient.id}>
                      Ships via {shippingQuote.serviceLabel} — tracking is emailed when the label prints.
                    </p>
                  )}
                  {choice === "SHIPPED" && shippingQuote?.available === false && (
                    <p className="mt-1 text-sm text-red-700" data-shipping-unavailable={recipient.id}>
                      {shippingQuote.reason}
                    </p>
                  )}
                  {feesByRecipient[recipient.id] > 0 && (
                    <p className="mt-1 text-sm text-stone-600" data-recipient-fee={recipient.id}>
                      {choice === "SHIPPED" ? "Shipping" : "Delivery fee"}: {formatCents(feesByRecipient[recipient.id])}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor={`greeting-${recipient.id}`}>Greeting card message</Label>
                  <Input
                    id={`greeting-${recipient.id}`}
                    value={greetings[recipient.id] ?? ""}
                    onChange={(event) =>
                      setGreetings((prev) => ({ ...prev, [recipient.id]: event.target.value }))
                    }
                    placeholder={orderGreeting || "Same as the order greeting"}
                    maxLength={500}
                  />
                  {recipient.rememberedGreeting && (
                    <p className="mt-1 text-xs text-stone-500">
                      Last time: “{recipient.rememberedGreeting}”
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {unassignedCount > 0 && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {unassignedCount} item{unassignedCount === 1 ? " isn’t" : "s aren’t"} assigned to a
          recipient yet —{" "}
          <Link href={builderHref ?? `/order?draft=${draftRef}`} className="underline">
            back to the builder
          </Link>
          .
        </p>
      )}

      <div className="mt-6">
        <Label htmlFor="order-greeting">Order greeting (used when a recipient has none)</Label>
        <Input
          id="order-greeting"
          value={orderGreeting}
          onChange={(event) => setOrderGreeting(event.target.value)}
          placeholder="Happy Purim!"
          maxLength={500}
        />
      </div>

      <div className="mt-6 flex flex-col gap-1 border-t border-stone-200 pt-4 text-sm text-stone-700">
        <div className="flex justify-between">
          <span>Items</span>
          <span data-checkout-subtotal>{formatCents(subtotalCents)}</span>
        </div>
        <div className="flex justify-between">
          <span>Delivery fees</span>
          <span data-checkout-fees>{formatCents(feesCents)}</span>
        </div>
        <div className="flex justify-between text-lg font-semibold text-stone-900">
          <span>Total</span>
          <span data-checkout-total>{formatCents(totalCents)}</span>
        </div>
      </div>

      {conflict && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4" data-checkout-conflict>
          <h3 className="font-semibold text-amber-900">This order changed since you started</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-amber-800">
            {conflict.priceConflicts.map((item) => (
              <li key={item.productName}>
                {item.productName}: was {formatCents(item.storedCents)}, now{" "}
                {formatCents(item.freshCents)}
              </li>
            ))}
            {conflict.stockIssues.map((item) => (
              <li key={item.productName}>
                {item.productName}: only {item.available} left (you asked for {item.requested})
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm font-medium text-amber-900">
            Fresh total: {formatCents(conflict.freshTotalCents)} — review and confirm again.
          </p>
          <Button variant="secondary" className="mt-3" onClick={() => window.location.reload()}>
            Reload with fresh totals
          </Button>
        </div>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {paymentUnavailable && (
        <p className="mt-4 rounded-md bg-stone-100 p-4 text-sm text-stone-700" data-payment-unconfigured>
          {paymentUnavailable}. Your order summary is saved — staff can take cash or check at the
          counter, or try again once card payments go live.
        </p>
      )}

      {pos ? (
        <div className="mt-6 flex flex-wrap items-end gap-4" data-pos-checkout>
          <div>
            <Label htmlFor="pos-method">Payment method</Label>
            <Select
              id="pos-method"
              className="mt-1"
              value={posMethod}
              onChange={(event) => setPosMethod(event.target.value as PosMethod)}
              data-pos-method
            >
              <option value="cash">Cash</option>
              <option value="check">Check</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="pos-amount">Amount collected</Label>
            <Input
              id="pos-amount"
              className="mt-1 w-28"
              type="number"
              step="0.01"
              min="0"
              value={posAmount ?? (totalCents / 100).toFixed(2)}
              onChange={(event) => setPosAmount(event.target.value)}
              data-pos-amount
            />
          </div>
          <Button
            onClick={completePosSale}
            disabled={isSubmitting || unassignedCount > 0}
            data-pos-complete
          >
            {isSubmitting ? "Working…" : `Complete sale — ${formatCents(totalCents)}`}
          </Button>
        </div>
      ) : (
        <div className="mt-6">
          <Button
            onClick={submitAndPay}
            disabled={isSubmitting || unassignedCount > 0}
            data-pay-button
          >
            {isSubmitting ? "Working…" : `Pay ${formatCents(totalCents)}`}
          </Button>
          <p className="mt-2 text-xs text-stone-500">
            Card checkout runs on Stripe&apos;s hosted page — we never see card numbers. Offline
            methods (cash/check) are staff-only.
          </p>
        </div>
      )}
    </div>
  );
}
