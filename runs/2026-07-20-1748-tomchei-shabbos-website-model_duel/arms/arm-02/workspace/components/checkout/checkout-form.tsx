"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCents } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Recipient = {
  key: string;
  name: string;
  summary: string;
  zip: string;
  rememberedGreeting: string | null;
};

type Method = { id: string; code: string; name: string; kind: string };

type FeeLine = { label: string; amountCents: number };

type QuoteResponse = {
  itemsCents: number;
  issues: string[];
  fees:
    | { ok: true; feesCents: number; feeLines: FeeLine[]; requiresDeliveryDay: boolean }
    | { ok: false; errors: string[] }
    | null;
};

export function CheckoutForm({
  itemsCents,
  lines,
  recipients,
  methods,
  deliveryZips,
  purimDayChoices,
  initialIssues,
  isGuest,
}: {
  itemsCents: number;
  lines: { id: string; productName: string; quantity: number; lineTotalCents: number; recipientKey: string }[];
  recipients: Recipient[];
  methods: Method[];
  deliveryZips: string[];
  purimDayChoices: string[];
  initialIssues: string[];
  isGuest: boolean;
}) {
  const defaultMethodId = methods.find((method) => method.kind === "PICKUP")?.id ?? methods[0]?.id ?? "";
  const [methodByRecipient, setMethodByRecipient] = useState<Record<string, string>>(
    () => Object.fromEntries(recipients.map((recipient) => [recipient.key, defaultMethodId]))
  );
  const [deliveryDay, setDeliveryDay] = useState<string>("");
  const [greetingDefault, setGreetingDefault] = useState("");
  const [greetingOverrides, setGreetingOverrides] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      recipients
        .filter((recipient) => recipient.rememberedGreeting)
        .map((recipient) => [recipient.key, recipient.rememberedGreeting!])
    )
  );
  const [donationDollars, setDonationDollars] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [conflictMessages, setConflictMessages] = useState<string[]>(initialIssues);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const choices = useMemo(
    () =>
      recipients.map((recipient) => ({
        recipientKey: recipient.key,
        methodId: methodByRecipient[recipient.key] ?? defaultMethodId,
      })),
    [recipients, methodByRecipient, defaultMethodId]
  );

  const fetchQuote = useCallback(async (): Promise<QuoteResponse | null> => {
    const response = await fetch("/api/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choices, deliveryDay: deliveryDay || null }),
    });
    return response.ok ? ((await response.json()) as QuoteResponse) : null;
  }, [choices, deliveryDay]);

  useEffect(() => {
    let active = true;
    fetchQuote().then((fresh) => {
      if (active && fresh) setQuote(fresh);
    });
    return () => {
      active = false;
    };
  }, [fetchQuote]);

  const donationCents = Math.max(0, Math.round(Number(donationDollars || "0") * 100)) || 0;
  const feesCents = quote?.fees && quote.fees.ok ? quote.fees.feesCents : 0;
  const liveItemsCents = quote?.itemsCents ?? itemsCents;
  const totalCents = liveItemsCents + feesCents + donationCents;
  const feeErrors = quote?.fees && !quote.fees.ok ? quote.fees.errors : [];
  const needsDeliveryDay =
    (quote?.fees && quote.fees.ok && quote.fees.requiresDeliveryDay) ||
    choices.some((choice) => methods.find((m) => m.id === choice.methodId)?.kind === "PER_PACKAGE_DELIVERY");

  async function placeOrder() {
    setIsSubmitting(true);
    setConflictMessages([]);
    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        choices,
        deliveryDay: deliveryDay || null,
        greetingDefault,
        greetingOverrides: Object.entries(greetingOverrides)
          .filter(([, greeting]) => greeting.trim())
          .map(([recipientKey, greeting]) => ({ recipientKey, greeting })),
        donationCents,
        expectedTotalCents: totalCents,
        guestContact: isGuest ? { name: guestName, email: guestEmail } : null,
      }),
    });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.url) {
      window.location.href = body.url;
      return;
    }
    setIsSubmitting(false);
    if (response.status === 409 && body?.messages) {
      // Stale prices/stock or changed fees (R-037): show what changed, refresh numbers.
      setConflictMessages(body.messages);
      const fresh = await fetchQuote();
      if (fresh) setQuote(fresh);
    } else {
      setConflictMessages([body?.error ?? "Could not start the payment — try again"]);
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      {conflictMessages.length > 0 && (
        <div className="rounded-md border border-danger/40 bg-danger/5 p-4" data-testid="checkout-conflict">
          <p className="text-sm font-semibold text-danger">Please review before paying:</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-danger">
            {conflictMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
          <Link href="/order" className="mt-2 inline-block text-sm font-medium text-brand hover:underline">
            Adjust my order
          </Link>
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold">Your items</h2>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {lines.map((line) => (
            <li key={line.id} className="flex justify-between">
              <span>
                {line.productName} × {line.quantity}
              </span>
              <span>{formatCents(line.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold">Delivery per recipient</h2>
        <ul className="mt-3 flex flex-col gap-4">
          {recipients.map((recipient) => {
            const inZone = deliveryZips.includes(recipient.zip);
            return (
              <li key={recipient.key} className="rounded-md border border-border p-3" data-testid="checkout-recipient">
                <p className="text-sm font-semibold">{recipient.name}</p>
                <p className="text-xs text-muted">{recipient.summary}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {methods.map((method) => {
                    const blocked = method.kind === "PER_PACKAGE_DELIVERY" && !inZone;
                    const selected = methodByRecipient[recipient.key] === method.id;
                    return (
                      <label
                        key={method.id}
                        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                          blocked
                            ? "cursor-not-allowed border-border text-muted opacity-60"
                            : selected
                              ? "border-brand bg-brand-soft text-brand-strong"
                              : "cursor-pointer border-border hover:bg-brand-soft"
                        }`}
                        title={blocked ? `ZIP ${recipient.zip} is outside the delivery area` : undefined}
                      >
                        <input
                          type="radio"
                          name={`method-${recipient.key}`}
                          className="sr-only"
                          disabled={blocked}
                          checked={selected}
                          onChange={() =>
                            setMethodByRecipient((current) => ({ ...current, [recipient.key]: method.id }))
                          }
                        />
                        {method.name}
                        {blocked && " (not available)"}
                      </label>
                    );
                  })}
                </div>
                <div className="mt-2">
                  <label className="text-xs text-muted" htmlFor={`greeting-${recipient.key}`}>
                    Greeting for {recipient.name} (leave blank to use the order greeting)
                  </label>
                  <Input
                    id={`greeting-${recipient.key}`}
                    value={greetingOverrides[recipient.key] ?? ""}
                    placeholder={recipient.rememberedGreeting ?? undefined}
                    onChange={(event) =>
                      setGreetingOverrides((current) => ({ ...current, [recipient.key]: event.target.value }))
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>

        {needsDeliveryDay && (
          <div className="mt-4">
            <label className="text-sm font-medium" htmlFor="delivery-day">
              Purim-week delivery day
            </label>
            <select
              id="delivery-day"
              className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
              value={deliveryDay}
              onChange={(event) => setDeliveryDay(event.target.value)}
              data-testid="delivery-day"
            >
              <option value="">Choose a day…</option>
              {purimDayChoices.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold">Greeting & donation</h2>
        <label className="mt-2 block text-xs text-muted" htmlFor="greeting-default">
          Order greeting (used for recipients without their own)
        </label>
        <Input
          id="greeting-default"
          value={greetingDefault}
          onChange={(event) => setGreetingDefault(event.target.value)}
          placeholder="A freilichen Purim!"
        />
        <label className="mt-3 block text-xs text-muted" htmlFor="donation">
          Add a donation (optional, dollars)
        </label>
        <Input
          id="donation"
          inputMode="decimal"
          value={donationDollars}
          onChange={(event) => setDonationDollars(event.target.value)}
          placeholder="0"
        />
      </section>

      {isGuest && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold">Your contact details</h2>
          <label className="mt-2 block text-xs text-muted" htmlFor="guest-name">
            Full name
          </label>
          <Input id="guest-name" value={guestName} onChange={(event) => setGuestName(event.target.value)} />
          <label className="mt-2 block text-xs text-muted" htmlFor="guest-email">
            Email
          </label>
          <Input
            id="guest-email"
            type="email"
            value={guestEmail}
            onChange={(event) => setGuestEmail(event.target.value)}
          />
        </section>
      )}

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex justify-between text-sm">
          <span>Items</span>
          <span>{formatCents(liveItemsCents)}</span>
        </div>
        {quote?.fees && quote.fees.ok &&
          quote.fees.feeLines.map((fee) => (
            <div key={fee.label} className="flex justify-between text-sm text-muted" data-testid="fee-line">
              <span>{fee.label}</span>
              <span>{formatCents(fee.amountCents)}</span>
            </div>
          ))}
        {donationCents > 0 && (
          <div className="flex justify-between text-sm text-muted">
            <span>Donation</span>
            <span>{formatCents(donationCents)}</span>
          </div>
        )}
        <div className="mt-2 flex justify-between border-t border-border pt-2 text-base font-semibold">
          <span>Total</span>
          <span data-testid="checkout-total">{formatCents(totalCents)}</span>
        </div>
        {feeErrors.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-sm text-danger" data-testid="fee-errors">
            {feeErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        <Button
          className="mt-4 w-full"
          onClick={placeOrder}
          disabled={isSubmitting || feeErrors.length > 0 || (isGuest && (!guestName.trim() || !guestEmail.trim()))}
          data-testid="pay-button"
        >
          {isSubmitting ? "Starting secure payment…" : "Pay with card"}
        </Button>
        <p className="mt-2 text-center text-xs text-muted">
          You&apos;ll finish paying on Stripe&apos;s secure checkout page.
        </p>
      </section>
    </div>
  );
}
