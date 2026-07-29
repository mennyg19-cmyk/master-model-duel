"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { formatCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// P10 (UR-007/G-012): the repeat REVIEW — the middle page between "Repeat
// this order" and the new draft. Shared by the customer flow
// (/account/orders/[id]/repeat) and the staff flow (/admin/orders/[id]/repeat);
// the only difference is the confirm endpoint.
//
// The plan types are `import type` from the server modules — erased at
// compile time, so no server code reaches the client bundle and the plan
// shape has one source of truth (lib/repeat/plan.ts + matcher.ts).

import type { PriceSuggestion as ReviewSuggestion } from "@/lib/repeat/matcher";
import type {
  RepeatPlanAddOn as ReviewAddOn,
  RepeatPlanLine as ReviewLine,
  RepeatPlanRecipient as ReviewRecipient,
  RepeatReviewPlan as ReviewPlan,
} from "@/lib/repeat/plan";

export type { ReviewAddOn, ReviewLine, ReviewPlan, ReviewRecipient, ReviewSuggestion };

type LineAction = { action: "keep" | "remove" | "swap"; targetProductId?: string };

export function RepeatReview({
  plan,
  confirmUrl,
  doneHrefPrefix,
  staff = false,
}: {
  plan: ReviewPlan;
  confirmUrl: string;
  /** Where the new draft opens after confirm; the draft ref is appended. */
  doneHrefPrefix: string;
  staff?: boolean;
}) {
  const router = useRouter();
  const [lineDecisions, setLineDecisions] = useState<Map<string, LineAction>>(
    () =>
      new Map(
        plan.lines.map((line) => [
          line.sourceLineId,
          // Price-smart default: the top suggestion is preselected, but an
          // unmapped line still needs an explicit swap-or-remove before
          // confirm is allowed (never a silent substitution).
          line.status === "auto"
            ? { action: "keep" as const }
            : { action: "swap" as const, targetProductId: line.suggestions?.[0]?.productId },
        ]),
      ),
  );
  const [removedRecipients, setRemovedRecipients] = useState<Set<string>>(new Set());
  const [greetings, setGreetings] = useState<Map<string, string>>(
    () => new Map(plan.recipients.map((r) => [r.sourceRecipientId, r.greeting])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unresolved = plan.lines.filter((line) => {
    if (line.status === "auto") return false;
    const decision = lineDecisions.get(line.sourceLineId);
    return decision?.action === "swap" && !decision.targetProductId;
  });

  function setLine(sourceLineId: string, decision: LineAction) {
    setLineDecisions((prev) => new Map(prev).set(sourceLineId, decision));
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = await apiFetch<{ draftRef?: string }>(confirmUrl, {
      method: "POST",
      body: {
        lines: plan.lines.map((line) => {
          const decision = lineDecisions.get(line.sourceLineId) ?? { action: "keep" as const };
          return { sourceLineId: line.sourceLineId, ...decision };
        }),
        recipients: plan.recipients.map((r) => ({
          sourceRecipientId: r.sourceRecipientId,
          action: removedRecipients.has(r.sourceRecipientId) ? ("remove" as const) : ("keep" as const),
          greeting: greetings.get(r.sourceRecipientId) ?? r.greeting,
        })),
      },
    });
    setBusy(false);
    if (!result.ok || !result.body.draftRef) {
      setError(result.body.error ?? "Could not create the repeat draft");
      return;
    }
    router.push(doneHrefPrefix + encodeURIComponent(result.body.draftRef));
  }

  const recipientName = (id: string | null) =>
    plan.recipients.find((r) => r.sourceRecipientId === id)?.name ?? null;

  return (
    <div data-repeat-review>
      {plan.unmappedCount > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900" data-unmapped-banner>
          {plan.unmappedCount} {plan.unmappedCount === 1 ? "item is" : "items are"} no longer in the {plan.targetSeasonName}{" "}
          catalog — pick a replacement or remove {plan.unmappedCount === 1 ? "it" : "them"} below.
        </p>
      )}

      <section className="mt-4 flex flex-col gap-3">
        {plan.lines.map((line) => {
          const decision = lineDecisions.get(line.sourceLineId) ?? { action: "keep" as const };
          const removed = decision.action === "remove";
          return (
            <Card
              key={line.sourceLineId}
              className={removed ? "p-4 opacity-50" : "p-4"}
              data-review-line={line.sourceName}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-stone-900">
                    {line.qty} × {line.sourceName}
                    {line.sourceOptionLabel ? <span className="text-stone-500"> ({line.sourceOptionLabel})</span> : null}
                  </p>
                  <p className="text-sm text-stone-500">was {formatCents(line.sourceUnitPriceCents)} each</p>
                </div>
                <label className="flex items-center gap-1.5 text-sm text-stone-600">
                  <input
                    type="checkbox"
                    checked={removed}
                    onChange={(event) =>
                      setLine(
                        line.sourceLineId,
                        event.target.checked
                          ? { action: "remove" }
                          : line.status === "auto"
                            ? { action: "keep" }
                            : { action: "swap", targetProductId: line.suggestions?.[0]?.productId },
                      )
                    }
                    data-remove-line
                  />
                  Remove
                </label>
              </div>

              {!removed && line.status === "auto" && (
                <div className="mt-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-900" data-auto-mapping>
                  → {line.targetName}
                  {line.optionLabel ? ` (${line.optionLabel})` : ""} · {formatCents(line.targetUnitPriceCents ?? 0)} each
                  {line.notes.map((note) => (
                    <span key={note} className="block text-xs text-amber-800">
                      {note}
                    </span>
                  ))}
                </div>
              )}

              {!removed && line.status === "unmapped" && (
                <div className="mt-2" data-unmapped-line>
                  <label className="block text-sm font-medium text-stone-700">
                    Replacement for {plan.targetSeasonName}
                    <select
                      className="mt-1 block w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                      value={decision.targetProductId ?? ""}
                      onChange={(event) =>
                        setLine(line.sourceLineId, { action: "swap", targetProductId: event.target.value || undefined })
                      }
                      data-swap-select
                    >
                      <option value="">— pick a replacement —</option>
                      {(line.suggestions ?? []).map((suggestion) => (
                        <option key={suggestion.productId} value={suggestion.productId}>
                          {suggestion.name} · {formatCents(suggestion.priceCents)} (
                          {suggestion.priceDeltaCents === 0
                            ? "same price"
                            : `${suggestion.priceDeltaCents > 0 ? "+" : "−"}${formatCents(Math.abs(suggestion.priceDeltaCents))}`}
                          )
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {!removed && line.addOns.length > 0 && (
                <ul className="mt-2 flex flex-col gap-0.5 text-sm text-stone-600">
                  {line.addOns.map((addOn) => (
                    <li key={addOn.sourceLineId} data-review-addon={addOn.sourceName}>
                      {addOn.status === "auto" ? "→" : "✕"} {addOn.qty} × {addOn.sourceName}
                      {addOn.status === "auto" && addOn.unitPriceCents !== null
                        ? ` · ${formatCents(addOn.unitPriceCents)} each`
                        : ""}
                      {addOn.note ? <span className="text-xs text-amber-800"> ({addOn.note})</span> : null}
                    </li>
                  ))}
                </ul>
              )}

              {!removed && line.sourceRecipientId && (
                <p className="mt-2 text-xs text-stone-500">
                  For: {recipientName(line.sourceRecipientId) ?? "recipient"}
                  {removedRecipients.has(line.sourceRecipientId) ? " (recipient removed — will need reassignment)" : ""}
                </p>
              )}
            </Card>
          );
        })}
      </section>

      <section className="mt-6">
        <h3 className="text-base font-semibold text-stone-900">Recipients</h3>
        <div className="mt-2 flex flex-col gap-3">
          {plan.recipients.map((recipient) => {
            const removed = removedRecipients.has(recipient.sourceRecipientId);
            return (
              <Card key={recipient.sourceRecipientId} className={removed ? "p-4 opacity-50" : "p-4"} data-review-recipient={recipient.name}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-stone-900">{recipient.name}</p>
                    <p className="text-sm text-stone-500">
                      {recipient.line1}
                      {recipient.line2 ? `, ${recipient.line2}` : ""}, {recipient.city}, {recipient.region}{" "}
                      {recipient.postalCode}
                    </p>
                    {recipient.matchedAddressId && (
                      <p className="text-xs text-green-700">matched to your address book</p>
                    )}
                  </div>
                  <label className="flex items-center gap-1.5 text-sm text-stone-600">
                    <input
                      type="checkbox"
                      checked={removed}
                      onChange={(event) =>
                        setRemovedRecipients((prev) => {
                          const next = new Set(prev);
                          if (event.target.checked) next.add(recipient.sourceRecipientId);
                          else next.delete(recipient.sourceRecipientId);
                          return next;
                        })
                      }
                      data-remove-recipient
                    />
                    Remove
                  </label>
                </div>
                {!removed && (
                  <label className="mt-2 block text-sm text-stone-700">
                    Card greeting
                    <textarea
                      className="mt-1 block w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                      rows={2}
                      value={greetings.get(recipient.sourceRecipientId) ?? ""}
                      onChange={(event) =>
                        setGreetings((prev) => new Map(prev).set(recipient.sourceRecipientId, event.target.value))
                      }
                      data-greeting-input
                    />
                  </label>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      {error && (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
      <div className="mt-6 flex items-center gap-3">
        <Button onClick={confirm} disabled={busy || unresolved.length > 0} data-confirm-repeat>
          {busy ? "Creating draft…" : `Confirm — create ${plan.targetSeasonName} draft`}
        </Button>
        {unresolved.length > 0 && (
          <p className="text-sm text-amber-800">Pick a replacement (or Remove) for every discontinued item first.</p>
        )}
      </div>
      {staff && <p className="mt-2 text-xs text-stone-500">Staff repeat — the draft lands on the customer&apos;s account.</p>}
    </div>
  );
}
