"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateFulfillmentFees } from "@/domain/fulfillment-fees";
import { formatCurrency } from "@/lib/currency";

type CheckoutPayload = {
  order: {
    id: string;
    draftReference: string;
    subtotalCents: number;
    defaultGreeting: string;
    lines: {
      id: string;
      quantity: number;
      unitPriceCentsSnapshot: number;
      product: { name: string };
      recipientAddress: {
        id: string;
        recipientName: string;
        line1: string;
        city: string;
        region: string;
        postalCode: string;
        rememberedGreeting: string | null;
      } | null;
    }[];
    season: {
      fulfillmentMethods: {
        code: "BULK_DELIVERY" | "PACKAGE_DELIVERY" | "SHIPPING" | "PICKUP";
        displayName: string;
      }[];
    };
  };
  fulfillmentFees: Record<string, number>;
  shippingFeesByAddressId: Record<string, number>;
  isLiveShippingAvailable: boolean;
  deliveryDays: string[];
  deliveryZips: string[];
};

type LineChoice = {
  orderLineId: string;
  fulfillmentCode: "BULK_DELIVERY" | "PACKAGE_DELIVERY" | "SHIPPING" | "PICKUP";
  greeting: string;
  deliveryDay: string | null;
};

export function CheckoutForm({ draftId }: { draftId: string }) {
  const [checkout, setCheckout] = useState<CheckoutPayload | null>(null);
  const [choices, setChoices] = useState<LineChoice[]>([]);
  const [defaultGreeting, setDefaultGreeting] = useState("A freilichen Purim!");
  const [donationDollars, setDonationDollars] = useState(0);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [state, setState] = useState("Loading checkout…");

  useEffect(() => {
    void fetch(`/api/checkout/stripe?draftId=${encodeURIComponent(draftId)}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Checkout could not be loaded.");
        const typedPayload = payload as CheckoutPayload;
        setCheckout(typedPayload);
        setDefaultGreeting(typedPayload.order.defaultGreeting || "A freilichen Purim!");
        setChoices(
          typedPayload.order.lines.map((line) => ({
            orderLineId: line.id,
            fulfillmentCode: "BULK_DELIVERY",
            greeting: line.recipientAddress?.rememberedGreeting ?? "",
            deliveryDay: typedPayload.deliveryDays[0] ?? null,
          })),
        );
        setState("Ready");
      })
      .catch((error) => setState(error instanceof Error ? error.message : "Checkout failed."));
  }, [draftId]);

  const fulfillmentCents = useMemo(() => {
    if (!checkout) return 0;
    const addressIdsByLineId = new Map(
      checkout.order.lines.flatMap((line) =>
        line.recipientAddress ? [[line.id, line.recipientAddress.id] as const] : [],
      ),
    );
    const feesByLineId = calculateFulfillmentFees(
      choices,
      addressIdsByLineId,
      new Map(Object.entries(checkout.shippingFeesByAddressId)),
    );
    return [...feesByLineId.values()].reduce((sum, fee) => sum + fee, 0);
  }, [checkout, choices]);
  const donationCents = Math.max(0, Math.round(donationDollars * 100));
  const totalCents =
    (checkout?.order.lines.reduce(
      (sum, line) => sum + line.unitPriceCentsSnapshot * line.quantity,
      0,
    ) ?? 0) +
    fulfillmentCents +
    donationCents;

  function updateChoice(orderLineId: string, changes: Partial<LineChoice>) {
    setChoices((current) =>
      current.map((choice) =>
        choice.orderLineId === orderLineId ? { ...choice, ...changes } : choice,
      ),
    );
  }

  async function startPayment() {
    setState("Validating price and stock…");
    setConflicts([]);
    const response = await fetch(
      `/api/checkout/stripe?draftId=${encodeURIComponent(draftId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method: "STRIPE",
          defaultGreeting,
          donationCents,
          expectedTotalCents: totalCents,
          choices,
        }),
      },
    );
    const payload = await response.json();
    if (!response.ok) {
      setState(payload.error ?? "Checkout could not continue.");
      setConflicts(payload.conflicts ?? []);
      return;
    }
    setState("Redirecting to Stripe…");
    window.location.assign(payload.url);
  }

  if (!checkout) {
    return (
      <main className="grid min-h-[60vh] place-items-center bg-[var(--cream)] px-5">
        <p className="font-bold">{state}</p>
      </main>
    );
  }

  return (
    <main className="bg-[var(--cream)] px-5 py-12">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1fr_360px]">
        <section>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
            Checkout · {checkout.order.draftReference}
          </p>
          <h1 className="mt-3 font-serif text-4xl font-bold">Delivery and greetings</h1>
          <label className="mt-7 block rounded-2xl border border-[var(--border)] bg-white p-5 font-bold">
            Default greeting
            <textarea
              className="mt-2 min-h-24 w-full rounded-xl border border-[var(--border)] p-3 font-normal"
              maxLength={500}
              onChange={(event) => setDefaultGreeting(event.target.value)}
              value={defaultGreeting}
            />
          </label>
          <div className="mt-6 space-y-5">
            {checkout.order.lines.map((line) => {
              const choice = choices.find((candidate) => candidate.orderLineId === line.id);
              const isOutOfZone =
                !line.recipientAddress ||
                !checkout.deliveryZips.includes(line.recipientAddress.postalCode);
              return (
                <article
                  className="rounded-2xl border border-[var(--border)] bg-white p-5"
                  key={line.id}
                >
                  <h2 className="text-xl font-black">
                    {line.recipientAddress?.recipientName ?? "Recipient required"}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {line.product.name} × {line.quantity} · {line.recipientAddress?.line1},{" "}
                    {line.recipientAddress?.city} {line.recipientAddress?.postalCode}
                  </p>
                  <label className="mt-4 block text-sm font-bold">
                    Fulfillment
                    <select
                      className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2"
                      onChange={(event) =>
                        updateChoice(line.id, {
                          fulfillmentCode: event.target.value as LineChoice["fulfillmentCode"],
                        })
                      }
                      value={choice?.fulfillmentCode ?? "BULK_DELIVERY"}
                    >
                      {checkout.order.season.fulfillmentMethods.map((method) => (
                        <option
                          disabled={
                            (method.code === "PACKAGE_DELIVERY" && isOutOfZone) ||
                            (method.code === "SHIPPING" &&
                              !checkout.isLiveShippingAvailable)
                          }
                          key={method.code}
                          value={method.code}
                        >
                          {method.displayName} (+
                          {formatCurrency(
                            method.code === "SHIPPING"
                              ? checkout.shippingFeesByAddressId[
                                  line.recipientAddress?.id ?? ""
                                ] ?? 0
                              : checkout.fulfillmentFees[method.code] ?? 0,
                          )}
                          )
                          {method.code === "PACKAGE_DELIVERY" && isOutOfZone
                            ? " — outside delivery area"
                            : method.code === "SHIPPING" &&
                                !checkout.isLiveShippingAvailable
                              ? " — live rates unavailable"
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {choice?.fulfillmentCode.includes("DELIVERY") && (
                    <label className="mt-3 block text-sm font-bold">
                      Delivery day
                      <select
                        className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2"
                        onChange={(event) => updateChoice(line.id, { deliveryDay: event.target.value })}
                        value={choice.deliveryDay ?? ""}
                      >
                        {checkout.deliveryDays.map((day) => (
                          <option key={day} value={day}>{day}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="mt-3 block text-sm font-bold">
                    Greeting override
                    <textarea
                      className="mt-1 min-h-20 w-full rounded-xl border border-[var(--border)] p-3 font-normal"
                      maxLength={500}
                      onChange={(event) => updateChoice(line.id, { greeting: event.target.value })}
                      placeholder={defaultGreeting}
                      value={choice?.greeting ?? ""}
                    />
                  </label>
                </article>
              );
            })}
          </div>
        </section>
        <aside className="h-fit rounded-[2rem] border border-[var(--border)] bg-white p-6 lg:sticky lg:top-5">
          <h2 className="text-2xl font-black">Order summary</h2>
          <dl className="mt-5 space-y-3">
            <div className="flex justify-between"><dt>Gifts</dt><dd>{formatCurrency(totalCents - fulfillmentCents - donationCents)}</dd></div>
            <div className="flex justify-between"><dt>Fulfillment</dt><dd>{formatCurrency(fulfillmentCents)}</dd></div>
          </dl>
          <label className="mt-5 block text-sm font-bold">
            Optional donation
            <input
              className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2"
              min="0"
              onChange={(event) => setDonationDollars(Number(event.target.value))}
              step="1"
              type="number"
              value={donationDollars}
            />
          </label>
          <div className="mt-5 flex justify-between border-t border-[var(--border)] pt-5 text-xl font-black">
            <span>Total</span><span>{formatCurrency(totalCents)}</span>
          </div>
          {conflicts.length > 0 && (
            <ul className="mt-5 list-disc rounded-xl bg-red-50 p-5 pl-9 text-sm font-bold text-red-900">
              {conflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}
            </ul>
          )}
          <button
            className="mt-6 w-full rounded-full bg-[var(--ink)] px-6 py-3 font-bold text-white"
            onClick={() => void startPayment()}
            type="button"
          >
            Continue to hosted Stripe
          </button>
          <p className="mt-3 text-center text-sm text-[var(--muted)]">{state}</p>
        </aside>
      </div>
    </main>
  );
}
