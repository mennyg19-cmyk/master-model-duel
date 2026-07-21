"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/storefront/catalog-shared";

type Candidate = {
  productId: string;
  name: string;
  sku: string;
  basePriceCents: number;
};

type Line = {
  sourceLineId: string;
  quantity: number;
  unitPriceCents: number;
  greeting: string | null;
  recipient: {
    recipientName: string | null;
    addressLine1: string | null;
    city: string | null;
    savedAddressId: string | null;
  };
  replacement: {
    sourceName: string;
    sourceSku: string;
    sourcePriceCents: number;
    candidates: Candidate[];
    priceSmartProductId: string | null;
    needsPick: boolean;
    alreadyInTarget: boolean;
  };
  defaultProductId: string | null;
  requiresPick: boolean;
};

type Preview = {
  sourceOrderId: string;
  targetSeasonId: string;
  targetSeasonName: string;
  lines: Line[];
  blockers: string[];
};

type Props = {
  orderId: string;
  /** account = customer GET/POST; staff = admin preview/confirm modes */
  audience?: "account" | "staff";
};

export function RepeatReviewClient({ orderId, audience = "account" }: Props) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [removes, setRemoves] = useState<Record<string, boolean>>({});
  const [keepRecipients, setKeepRecipients] = useState<Record<string, boolean>>({});
  const [replacementsConfirmed, setReplacementsConfirmed] = useState(false);
  const [recipientsConfirmed, setRecipientsConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiPath =
    audience === "staff"
      ? `/api/admin/orders/${orderId}/repeat`
      : `/api/account/orders/${orderId}/repeat`;

  useEffect(() => {
    void (async () => {
      const res =
        audience === "staff"
          ? await fetch(apiPath, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ mode: "preview" }),
            })
          : await fetch(apiPath);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Could not load repeat preview");
        return;
      }
      const nextPreview = json.preview as Preview;
      setPreview(nextPreview);
      const nextPicks: Record<string, string> = {};
      const nextKeep: Record<string, boolean> = {};
      for (const line of nextPreview.lines) {
        if (line.defaultProductId) nextPicks[line.sourceLineId] = line.defaultProductId;
        nextKeep[line.sourceLineId] = true;
      }
      setPicks(nextPicks);
      setKeepRecipients(nextKeep);
    })();
  }, [orderId, audience, apiPath]);

  async function confirm() {
    if (!preview) return;
    if (!replacementsConfirmed || !recipientsConfirmed) {
      setMessage("Confirm both replacements and recipients before continuing.");
      return;
    }
    setMessage(null);
    const decisions = preview.lines.map((line) => {
      if (removes[line.sourceLineId]) {
        return { sourceLineId: line.sourceLineId, action: "remove" as const };
      }
      return {
        sourceLineId: line.sourceLineId,
        action: "map" as const,
        toProductId: picks[line.sourceLineId] || line.defaultProductId || null,
        keepRecipient: keepRecipients[line.sourceLineId] !== false,
        savedAddressId: line.recipient.savedAddressId,
      };
    });

    const res = await fetch(apiPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        audience === "staff"
          ? {
              mode: "confirm",
              targetSeasonId: preview.targetSeasonId,
              choices: decisions,
            }
          : {
              targetSeasonId: preview.targetSeasonId,
              choices: decisions,
            },
      ),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "Confirm failed");
      return;
    }
    if (audience === "staff") {
      router.push(`/admin/orders/${json.orderId}`);
    } else {
      router.push(`/order?draft=${json.draftRef}`);
    }
  }

  if (error) {
    return <p className="text-sm text-red-700">{error}</p>;
  }
  if (!preview) {
    return <p className="text-sm">Loading repeat review…</p>;
  }

  return (
    <div className="space-y-6" data-testid="repeat-review">
      <p className="text-sm text-[var(--color-ink)]/70">
        Repeating into <strong>{preview.targetSeasonName}</strong>. Confirm replacements and
        recipients before continuing.
      </p>
      {preview.blockers.length ? (
        <ul className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="repeat-blockers">
          {preview.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-semibold text-[var(--color-forest)]">Replacements</h2>
        {preview.lines.map((line) => (
          <div
            key={line.sourceLineId}
            className="rounded border bg-white p-3 text-sm"
            data-testid={`repeat-line-${line.sourceLineId}`}
          >
            <p className="font-semibold">
              {line.replacement.sourceName} × {line.quantity}{" "}
              <span className="font-normal opacity-70">
                ({formatCents(line.replacement.sourcePriceCents)})
                {line.requiresPick ? " · needs pick" : ""}
                {line.replacement.alreadyInTarget ? " · same season" : ""}
              </span>
            </p>
            {removes[line.sourceLineId] ? (
              <p className="mt-1 text-amber-800">Will be removed</p>
            ) : (
              <label className="mt-2 block">
                Replacement
                <select
                  className="mt-1 w-full rounded border px-2 py-1.5"
                  value={picks[line.sourceLineId] || ""}
                  onChange={(e) =>
                    setPicks((p) => ({ ...p, [line.sourceLineId]: e.target.value }))
                  }
                  required={line.requiresPick}
                  data-testid={`repeat-pick-${line.sourceLineId}`}
                >
                  <option value="">— pick —</option>
                  {line.replacement.candidates.map((c) => (
                    <option key={c.productId} value={c.productId}>
                      {c.name} ({formatCents(c.basePriceCents)})
                      {c.productId === line.replacement.priceSmartProductId
                        ? " · price-smart"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={Boolean(removes[line.sourceLineId])}
                onChange={(e) =>
                  setRemoves((r) => ({ ...r, [line.sourceLineId]: e.target.checked }))
                }
              />
              Remove this item
            </label>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-[var(--color-forest)]">Recipients</h2>
        <ul className="space-y-2">
          {preview.lines.map((line) => (
            <li key={`r-${line.sourceLineId}`} className="rounded border bg-white p-3 text-sm">
              <p className="font-semibold">{line.recipient.recipientName || "No recipient"}</p>
              <p>
                {[line.recipient.addressLine1, line.recipient.city].filter(Boolean).join(", ") ||
                  "No address"}
              </p>
              {line.greeting ? <p className="opacity-70">{line.greeting}</p> : null}
              {!removes[line.sourceLineId] ? (
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={keepRecipients[line.sourceLineId] !== false}
                    onChange={(e) =>
                      setKeepRecipients((k) => ({
                        ...k,
                        [line.sourceLineId]: e.target.checked,
                      }))
                    }
                    data-testid={`keep-recipient-${line.sourceLineId}`}
                  />
                  Keep this recipient
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={replacementsConfirmed}
            onChange={(e) => setReplacementsConfirmed(e.target.checked)}
            data-testid="confirm-replacements"
          />
          I confirm the replacement picks (or removals)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={recipientsConfirmed}
            onChange={(e) => setRecipientsConfirmed(e.target.checked)}
            data-testid="confirm-recipients"
          />
          I confirm the recipients and greetings
        </label>
      </div>

      <Button type="button" onClick={() => void confirm()} data-testid="confirm-repeat">
        Continue to draft
      </Button>
      {message ? (
        <p className="text-sm text-red-700" data-testid="repeat-message">
          {message}
        </p>
      ) : null}
    </div>
  );
}
