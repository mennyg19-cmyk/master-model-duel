"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FulfillmentKind, PackageStage } from "@prisma/client";
import { apiFetch } from "@/lib/api-client";

// Channel bulk moves + print batch triggers for the fulfillment dashboard
// (R-072, UR-005). One shared busy/message strip per instance.

type StageCounts = Record<PackageStage, number>;

type ChannelProps = { mode: "channel"; methodId: string; methodKind: FulfillmentKind; stageCounts: StageCounts };
type PrintProps = { mode: "print"; filingGroups: string[] };
type OrderProps = { mode: "order"; orderId: string };

const CHANNEL_MOVES: { from: keyof StageCounts; to: string; label: string }[] = [
  { from: "NEW", to: "PRINTED", label: "New → Printed" },
  { from: "PRINTED", to: "PACKED", label: "Printed → Packed" },
];

export function FulfillmentActions(props: ChannelProps | PrintProps | OrderProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post<T>(body: unknown, url: string, note: (result: T) => string) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiFetch<T>(url, { body });
      setMessage(result.ok ? note(result.body) : result.error);
      if (result.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (props.mode === "channel") {
    const terminal = props.methodKind === "PICKUP" ? "PICKED_UP" : "SENT";
    const moves = [
      ...CHANNEL_MOVES,
      { from: "PACKED" as const, to: terminal, label: `Packed → ${terminal === "PICKED_UP" ? "Picked up" : "Sent"}` },
    ];
    return (
      <div className="flex flex-wrap items-center gap-1">
        {moves
          .filter((move) => props.stageCounts[move.from] > 0)
          .map((move) => (
            <button
              key={move.label}
              type="button"
              disabled={busy}
              onClick={() =>
                post(
                  { methodId: props.methodId, from: move.from, to: move.to },
                  "/api/admin/packages/bulk-stage",
                  (body: { moved: number }) => `Moved ${body.moved} package(s)`
                )
              }
              className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-brand-soft disabled:opacity-50"
            >
              {move.label} ({props.stageCounts[move.from]})
            </button>
          ))}
        {message && <span className="text-xs text-muted">{message}</span>}
      </div>
    );
  }

  if (props.mode === "order") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            post(
              { action: "reprint-order", orderId: props.orderId },
              "/api/admin/print-batches",
              (body: { batch: { artifacts: unknown[] } }) =>
                `Reprinted this order's paperwork: ${body.batch.artifacts.length} artifact(s) — see Fulfillment`
            )
          }
          className="rounded-md border border-border px-3 py-1 text-sm hover:bg-brand-soft disabled:opacity-50"
        >
          Reprint order paperwork
        </button>
        {message && <span className="text-xs text-muted">{message}</span>}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            post({ action: "nightly" }, "/api/admin/print-batches", (body: { replayed: boolean; batch: { artifacts: unknown[] } }) =>
              body.replayed
                ? "Tonight's batch already ran — showing the existing artifacts"
                : `Nightly batch created ${body.batch.artifacts.length} artifact(s)`
            )
          }
          className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
        >
          Run nightly batch
        </button>
        {props.filingGroups.map((group) => (
          <button
            key={group}
            type="button"
            disabled={busy}
            onClick={() =>
              post(
                { action: "reprint-group", filingGroup: group },
                "/api/admin/print-batches",
                (body: { batch: { artifacts: unknown[] } }) =>
                  `Reprinted ${group}: ${body.batch.artifacts.length} artifact(s)`
              )
            }
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-brand-soft disabled:opacity-50"
          >
            Reprint {group}
          </button>
        ))}
      </div>
      {message && (
        <p className="mt-2 rounded-md border border-border bg-brand-soft/40 p-2 text-sm" data-testid="print-message">
          {message}
        </p>
      )}
    </div>
  );
}
