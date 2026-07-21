"use client";

import { useCallback, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { formatCents } from "@/lib/catalog";
import { Card, CardTitle } from "@/components/ui/card";

// POS step 3: server-quoted totals (never client fee math) + cash/check capture.

type PosQuote = {
  itemsCents: number;
  issues: string[];
  recipients: { key: string; recipientName: string; cityZip: string; rememberedGreeting: string | null }[];
  methods: { id: string; name: string; kind: string }[];
  purimDayChoices: string[];
  fees: { ok: true; feesCents: number; feeLines: { label: string; amountCents: number }[]; requiresDeliveryDay: boolean } | { ok: false; errors: string[] } | null;
};

export function PosCheckout({
  customerId,
  onDone,
}: {
  customerId: string;
  onDone: (summary: { orderNumber: number | null; totalCents: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState<PosQuote | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [deliveryDay, setDeliveryDay] = useState<string>("");
  const [greetingDefault, setGreetingDefault] = useState("");
  const [payMethod, setPayMethod] = useState<"CASH" | "CHECK">("CASH");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchQuote = useCallback(
    async (nextChoices: Record<string, string>, nextDeliveryDay: string) => {
      setError(null);
      const choiceList = Object.entries(nextChoices).map(([recipientKey, methodId]) => ({ recipientKey, methodId }));
      const result = await apiFetch<PosQuote>("/api/admin/pos/quote", {
        method: "POST",
        body: {
          customerId,
          choices: choiceList.length ? choiceList : null,
          deliveryDay: nextDeliveryDay || null,
        },
      });
      if (!result.ok) {
        setError(result.error);
        setQuote(null);
        return;
      }
      setQuote(result.body);
    },
    [customerId]
  );

  // Event-driven refetch: opening the panel and every choice/day change asks
  // the server for a fresh quote — no client-side fee math to drift.
  const updateChoices = (next: Record<string, string>) => {
    setChoices(next);
    fetchQuote(next, deliveryDay);
  };
  const updateDeliveryDay = (next: string) => {
    setDeliveryDay(next);
    fetchQuote(choices, next);
  };

  if (!open) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            fetchQuote(choices, deliveryDay);
          }}
          className="rounded-md bg-brand px-5 py-2.5 font-semibold text-white hover:bg-brand-strong"
          data-testid="pos-checkout-open"
        >
          Continue to payment
        </button>
      </div>
    );
  }

  const feesOk = quote?.fees && quote.fees.ok ? quote.fees : null;
  const totalCents = quote ? quote.itemsCents + (feesOk?.feesCents ?? 0) : 0;
  const allChosen = quote ? quote.recipients.every((recipient) => choices[recipient.key]) : false;
  const needsDay = feesOk?.requiresDeliveryDay ?? false;

  async function submit() {
    if (!quote || !feesOk || !allChosen || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ orderNumber: number | null; totalCents: number }>("/api/admin/pos/checkout", {
        method: "POST",
        body: {
          customerId,
          choices: Object.entries(choices).map(([recipientKey, methodId]) => ({ recipientKey, methodId })),
          deliveryDay: deliveryDay || null,
          greetingDefault,
          expectedTotalCents: totalCents,
          payment: { method: payMethod, note: note || undefined },
        },
      });
      if (!result.ok) {
        setError(result.error);
        const failure = result.body as { freshTotalCents?: number } | null;
        if (failure?.freshTotalCents) fetchQuote(choices, deliveryDay);
        return;
      }
      onDone({ orderNumber: result.body.orderNumber, totalCents: result.body.totalCents });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4 max-w-3xl" data-testid="pos-checkout">
      <CardTitle className="mb-3">Payment</CardTitle>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      {quote?.issues.length ? (
        <ul className="mb-2 list-disc pl-5 text-sm text-danger">
          {quote.issues.map((issue, index) => (
            <li key={index}>{issue}</li>
          ))}
        </ul>
      ) : null}

      {quote && (
        <>
          <div className="space-y-2 text-sm">
            {quote.recipients.map((recipient) => (
              <div key={recipient.key} className="flex items-center justify-between gap-3">
                <span>
                  {recipient.recipientName} <span className="text-muted">({recipient.cityZip})</span>
                </span>
                <select
                  value={choices[recipient.key] ?? ""}
                  onChange={(event) => updateChoices({ ...choices, [recipient.key]: event.target.value })}
                  className="rounded-md border border-border bg-white px-2 py-1 text-ink"
                >
                  <option value="">Choose delivery…</option>
                  {quote.methods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {needsDay && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <span className="text-muted">Purim delivery day</span>
              <select
                value={deliveryDay}
                onChange={(event) => updateDeliveryDay(event.target.value)}
                className="rounded-md border border-border bg-white px-2 py-1 text-ink"
              >
                <option value="">Choose…</option>
                {quote.purimDayChoices.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="mt-3 block text-sm">
            <span className="text-muted">Greeting (default for all packages)</span>
            <input
              value={greetingDefault}
              onChange={(event) => setGreetingDefault(event.target.value)}
              maxLength={500}
              className="mt-1 w-full rounded-md border border-border bg-white px-3 py-1.5 text-ink"
            />
          </label>

          <div className="mt-3 border-t border-border pt-3 text-sm space-y-1">
            <p className="flex justify-between">
              <span className="text-muted">Items</span>
              <span>{formatCents(quote.itemsCents)}</span>
            </p>
            {feesOk?.feeLines.map((fee, index) => (
              <p key={index} className="flex justify-between">
                <span className="text-muted">{fee.label}</span>
                <span>{formatCents(fee.amountCents)}</span>
              </p>
            ))}
            {quote.fees && !quote.fees.ok && (
              <ul className="list-disc pl-5 text-danger">
                {quote.fees.errors.map((feeError, index) => (
                  <li key={index}>{feeError}</li>
                ))}
              </ul>
            )}
            <p className="flex justify-between font-semibold">
              <span>Total due</span>
              <span data-testid="pos-total">{formatCents(totalCents)}</span>
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-xs text-muted">
              Method
              <select
                value={payMethod}
                onChange={(event) => setPayMethod(event.target.value as "CASH" | "CHECK")}
                className="mt-1 rounded-md border border-border bg-white px-2 py-1.5 text-sm text-ink"
              >
                <option value="CASH">Cash</option>
                <option value="CHECK">Check</option>
              </select>
            </label>
            <label className="flex flex-col text-xs text-muted">
              Note
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                placeholder="Check #, drawer, etc."
                className="mt-1 w-48 rounded-md border border-border bg-white px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <button
              type="button"
              disabled={busy || !feesOk || !allChosen || (needsDay && !deliveryDay) || totalCents <= 0}
              onClick={submit}
              className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
              data-testid="pos-take-payment"
            >
              Take {formatCents(totalCents)} {payMethod === "CASH" ? "cash" : "check"}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
