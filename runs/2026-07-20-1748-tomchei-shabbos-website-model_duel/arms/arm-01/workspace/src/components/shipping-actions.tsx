"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCurrency } from "@/lib/currency";

export type ShippingPackage = {
  id: string;
  isShipping: boolean;
  stage: string;
  quoteSummary?: {
    chargedCents: number;
    purchasedCents: number;
    marginCents: number;
  } | null;
  label?: {
    status: string;
    provider: string;
    serviceCode: string;
    trackingNumber: string | null;
    trackingStatus: string | null;
    labelUrl: string | null;
    chargedCents: number;
    purchasedCents: number;
    marginCents: number;
  } | null;
};

export function ShippingActions({ packageRecord }: { packageRecord: ShippingPackage }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  if (!packageRecord.isShipping) return null;

  async function run(action: "quote" | "buy" | "void" | "track" | "validate") {
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/shipping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, packageId: packageRecord.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        isValid?: boolean;
        messages?: string[];
      };
      if (!response.ok) {
        setMessage(payload.error ?? "Shipping action failed.");
        return;
      }
      setMessage(
        action === "validate"
          ? payload.isValid
            ? "Shippo validated this address."
            : payload.messages?.join(" ") || "Shippo marked this address for review."
          : `${action[0]!.toUpperCase()}${action.slice(1)} completed.`,
      );
      router.refresh();
    } catch {
      setMessage("Shipping action could not reach the server.");
    } finally {
      setIsBusy(false);
    }
  }

  const label = packageRecord.label;
  return (
    <div className="mt-4 rounded-2xl bg-[var(--surface)] p-4">
      <p className="font-black">Carrier shipping</p>
      {packageRecord.quoteSummary && !label && (
        <p className="mt-1 text-sm text-[var(--muted)]">
          Charge {formatCurrency(packageRecord.quoteSummary.chargedCents)} · buy{" "}
          {formatCurrency(packageRecord.quoteSummary.purchasedCents)} · margin{" "}
          {formatCurrency(packageRecord.quoteSummary.marginCents)}
        </p>
      )}
      {label && (
        <div className="mt-1 text-sm">
          <p>
            {label.provider.toUpperCase()} {label.serviceCode} · {label.status}
          </p>
          <p className="text-[var(--muted)]">
            Charged {formatCurrency(label.chargedCents)} · paid{" "}
            {formatCurrency(label.purchasedCents)} · margin{" "}
            {formatCurrency(label.marginCents)}
          </p>
          {label.trackingNumber && (
            <p>
              {label.trackingNumber} · {label.trackingStatus ?? "UNKNOWN"}
            </p>
          )}
          {label.labelUrl && (
            <a className="font-bold text-[var(--brand-dark)] underline" href={label.labelUrl}>
              Open label PDF
            </a>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="rounded-lg border px-3 py-1 text-sm font-bold" disabled={isBusy} onClick={() => void run("validate")} type="button">Validate address</button>
        <button className="rounded-lg border px-3 py-1 text-sm font-bold" disabled={isBusy || label?.status === "PURCHASED"} onClick={() => void run("quote")} type="button">Get live rates</button>
        <button className="rounded-lg bg-[var(--ink)] px-3 py-1 text-sm font-bold text-white disabled:opacity-50" disabled={isBusy || Boolean(label) || !packageRecord.quoteSummary} onClick={() => void run("buy")} type="button">Buy cheapest label</button>
        {label?.status === "PURCHASED" && (
          <>
            <button className="rounded-lg border px-3 py-1 text-sm font-bold" disabled={isBusy} onClick={() => void run("track")} type="button">Refresh tracking</button>
            <button className="rounded-lg border border-red-300 px-3 py-1 text-sm font-bold text-red-800 disabled:opacity-50" disabled={isBusy || ["SENT", "PICKED_UP"].includes(packageRecord.stage)} onClick={() => void run("void")} type="button">Void label</button>
          </>
        )}
      </div>
      {message && <p className="mt-2 text-sm font-semibold" role="status">{message}</p>}
    </div>
  );
}
