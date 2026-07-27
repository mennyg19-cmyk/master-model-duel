"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { formatCents } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { RepeatPlan } from "@/lib/repeat";

type LineChoice = {
  removed: boolean;
  productId: string;
  keepRecipient: boolean;
};

/**
 * The repeat review form (UR-007): one row per prior line. Discontinued items
 * default to the price-smart suggestion (G-011) but stay clearly flagged;
 * confirming with an unresolved line is refused here AND server-side.
 */
export function RepeatReview({ plan }: { plan: RepeatPlan }) {
  const router = useRouter();
  const [choices, setChoices] = useState<Record<string, LineChoice>>(() =>
    Object.fromEntries(
      plan.lines.map((line) => [
        line.lineId,
        {
          removed: false,
          productId:
            line.mapping.kind === "unmapped" ? line.mapping.suggestedProductId ?? "" : line.mapping.productId,
          keepRecipient: line.recipientValid,
        },
      ])
    )
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setChoice = (lineId: string, patch: Partial<LineChoice>) =>
    setChoices((current) => ({ ...current, [lineId]: { ...current[lineId], ...patch } }));

  const keptCount = plan.lines.filter((line) => !choices[line.lineId].removed).length;
  const unresolved = plan.lines.filter(
    (line) => !choices[line.lineId].removed && !choices[line.lineId].productId
  );

  async function confirm() {
    setError(null);
    if (unresolved.length > 0) {
      setError(`Pick a replacement or remove: ${unresolved.map((line) => line.originalProductName).join(", ")}`);
      return;
    }
    setBusy(true);
    try {
      const result = await apiFetch<{ ok: boolean; added: number }>("/api/repeat", {
        method: "POST",
        body: {
          orderId: plan.orderId,
          decisions: plan.lines.map((line) => {
            const choice = choices[line.lineId];
            return {
              lineId: line.lineId,
              productId: choice.removed ? null : choice.productId,
              keepRecipient: choice.keepRecipient,
            };
          }),
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/order");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="repeat-review">
      <ul className="flex flex-col gap-3">
        {plan.lines.map((line) => {
          const choice = choices[line.lineId];
          return (
            <li key={line.lineId}>
              <Card className={choice.removed ? "opacity-60" : undefined}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {line.originalProductName}
                      {line.quantity > 1 && ` ×${line.quantity}`}
                      <span className="ml-2 text-sm font-normal text-muted">
                        was {formatCents(line.unitPriceCents)}
                      </span>
                    </p>
                    {line.mapping.kind === "same" && <Badge tone="success">Still available</Badge>}
                    {line.mapping.kind === "replacement" && (
                      <Badge tone="brand">Replaced by {line.mapping.productName}</Badge>
                    )}
                    {line.mapping.kind === "unmapped" && <Badge tone="danger">No longer offered</Badge>}
                    {line.dropped.length > 0 && (
                      <p className="mt-1 text-xs text-muted">Won&apos;t carry over: {line.dropped.join(", ")}</p>
                    )}
                  </div>

                  <label className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={choice.removed}
                      onChange={(event) => setChoice(line.lineId, { removed: event.target.checked })}
                      className="accent-brand"
                    />
                    Remove
                  </label>
                </div>

                {!choice.removed && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-xs">
                      This year&apos;s item
                      <Select
                        value={choice.productId}
                        onChange={(event) => setChoice(line.lineId, { productId: event.target.value })}
                        className="mt-1 block w-full"
                        data-testid={`repeat-pick-${line.lineId}`}
                      >
                        {!choice.productId && <option value="">Pick a replacement…</option>}
                        {plan.candidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name} — {formatCents(candidate.basePriceCents)}
                            {line.mapping.kind === "unmapped" && candidate.id === line.mapping.suggestedProductId
                              ? " (suggested — closest price)"
                              : ""}
                          </option>
                        ))}
                      </Select>
                    </label>

                    <div className="text-xs">
                      <p className="font-medium">Recipient</p>
                      <p className="mt-1 text-muted">
                        {line.recipient.name} — {line.recipient.line1}
                        {line.recipient.line2 ? `, ${line.recipient.line2}` : ""}, {line.recipient.city},{" "}
                        {line.recipient.state} {line.recipient.zip}
                      </p>
                      {line.recipientValid ? (
                        <label className="mt-1 flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={choice.keepRecipient}
                            onChange={(event) => setChoice(line.lineId, { keepRecipient: event.target.checked })}
                            className="accent-brand"
                          />
                          Send to this recipient again
                        </label>
                      ) : (
                        <p className="mt-1 text-danger">
                          This saved address needs a fix — the item will be added without a recipient.
                        </p>
                      )}
                      {line.greeting && <p className="mt-1 italic text-muted">“{line.greeting}”</p>}
                    </div>
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={confirm} disabled={busy || keptCount === 0} data-testid="repeat-confirm">
          {busy ? "Adding…" : `Confirm and add ${keptCount} ${keptCount === 1 ? "item" : "items"} to cart`}
        </Button>
        <p className="text-xs text-muted">Items join your current draft — nothing already in your cart is lost.</p>
      </div>
    </div>
  );
}
