"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type PackageRow = {
  id: string;
  stage: string;
  version: number;
  recipientName: string;
  greeting: string;
  postalCode: string;
  fulfillmentMethod: { code: string; label: string };
  order: {
    id: string;
    orderNumber: number | null;
    draftRef: string;
    customer: { displayName: string } | null;
  };
  items: Array<{
    id: string;
    quantity: number;
    orderLine: { product: { name: string } };
  }>;
  audits: Array<{ id: string; note: string | null; toStage: string; createdAt: string }>;
};

const STAGES = ["NEW", "PRINTED", "PACKED", "SENT", "PICKED_UP"] as const;

export function PackageBoardClient() {
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [method, setMethod] = useState("");

  async function load() {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (method.trim()) params.set("method", method.trim());
    const res = await fetch(`/api/admin/packages?${params}`);
    const json = await res.json();
    if (res.ok) setPackages(json.packages ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function advance(toStage: string) {
    setMessage(null);
    const items = packages
      .filter((p) => selected.has(p.id))
      .map((p) => ({ packageId: p.id, expectedVersion: p.version }));
    if (items.length === 0) {
      setMessage("Select packages first");
      return;
    }
    const res = await fetch("/api/admin/packages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "stage", toStage, items }),
    });
    const json = await res.json();
    setMessage(
      res.ok
        ? `Advanced ${json.updated?.length ?? 0}; skipped ${json.skipped?.length ?? 0}`
        : json.error || "Stage update failed",
    );
    if (res.ok) {
      setSelected(new Set());
      await load();
    }
  }

  async function split(pkg: PackageRow) {
    setMessage(null);
    if (pkg.items.length < 2) {
      setMessage("Need at least 2 items to split");
      return;
    }
    const res = await fetch(`/api/admin/packages/${pkg.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "split",
        itemIds: [pkg.items[0]!.id],
        expectedVersion: pkg.version,
      }),
    });
    const json = await res.json();
    setMessage(
      res.ok
        ? `Split → new package ${json.newPackageId}`
        : json.error || "Split failed",
    );
    if (res.ok) await load();
  }

  async function regroup() {
    setMessage(null);
    const ids = [...selected];
    if (ids.length < 2) {
      setMessage("Select 2+ packages on the same order to regroup");
      return;
    }
    const res = await fetch("/api/admin/packages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "regroup", packageIds: ids }),
    });
    const json = await res.json();
    setMessage(res.ok ? `Regrouped into ${json.targetId}` : json.error || "Regroup failed");
    if (res.ok) {
      setSelected(new Set());
      await load();
    }
  }

  async function labelAction(packageId: string, action: "create" | "void" | "refresh") {
    setMessage(null);
    const res = await fetch(`/api/admin/packages/${packageId}/label`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || `Label ${action} failed`);
      return;
    }
    if (action === "create") {
      setMessage(
        `Label ${json.label?.trackingNumber ?? json.label?.id}: charge ${json.margin?.chargedCents}¢ buy ${json.margin?.purchasedCents}¢ margin ${json.margin?.marginCents}¢`,
      );
    } else if (action === "refresh") {
      setMessage(`Tracking: ${json.label?.trackingStatus ?? "refreshed"}`);
    } else {
      setMessage(`Voided label ${json.labelId}`);
    }
    await load();
  }

  return (
    <div className="space-y-4" data-testid="package-board">
      <div className="flex flex-wrap gap-2">
        <input
          className="rounded border px-2 py-1.5 text-sm"
          placeholder="Search recipient / order #"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="package-search"
        />
        <input
          className="rounded border px-2 py-1.5 text-sm"
          placeholder="Method code (SHIP)"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          data-testid="package-method-filter"
        />
        <Button type="button" variant="secondary" onClick={() => void load()} data-testid="package-refresh">
          Refresh
        </Button>
        <Button type="button" variant="secondary" onClick={() => void regroup()} data-testid="package-regroup">
          Regroup selected
        </Button>
      </div>

      <div className="flex flex-wrap gap-2" data-testid="package-bulk-stages">
        {STAGES.filter((s) => s !== "NEW").map((stage) => (
          <Button key={stage} type="button" onClick={() => void advance(stage)} data-testid={`bulk-stage-${stage}`}>
            Mark {stage}
          </Button>
        ))}
      </div>

      <p className="text-xs opacity-70">
        Print never auto-advances stage — use Mark Printed / Packed / Sent separately.
      </p>

      <ul className="space-y-3" data-testid="package-list">
        {packages.map((pkg) => (
          <li key={pkg.id} className="rounded bg-white p-4 shadow-sm" data-testid={`package-row-${pkg.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(pkg.id)}
                  onChange={() => toggle(pkg.id)}
                  data-testid={`package-select-${pkg.id}`}
                />
                <span>
                  <span className="font-semibold">{pkg.recipientName}</span>
                  {" · "}
                  {pkg.fulfillmentMethod.code}
                  {" · "}
                  <span data-testid={`package-stage-${pkg.id}`}>{pkg.stage}</span>
                  {" · v"}
                  {pkg.version}
                  <br />
                  <Link className="underline" href={`/admin/orders/${pkg.order.id}`}>
                    Order #{pkg.order.orderNumber ?? pkg.order.draftRef}
                  </Link>
                  {pkg.order.customer ? ` · ${pkg.order.customer.displayName}` : ""}
                </span>
              </label>
              <Button type="button" variant="secondary" onClick={() => void split(pkg)} data-testid={`package-split-${pkg.id}`}>
                Split first item
              </Button>
              {pkg.fulfillmentMethod.code === "SHIP" ? (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void labelAction(pkg.id, "create")}
                    data-testid={`package-label-create-${pkg.id}`}
                  >
                    Buy label
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void labelAction(pkg.id, "void")}
                    data-testid={`package-label-void-${pkg.id}`}
                  >
                    Void label
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void labelAction(pkg.id, "refresh")}
                    data-testid={`package-label-refresh-${pkg.id}`}
                  >
                    Refresh tracking
                  </Button>
                </div>
              ) : null}
            </div>
            <ul className="mt-2 text-xs opacity-80">
              {pkg.items.map((item) => (
                <li key={item.id}>
                  {item.quantity}× {item.orderLine.product.name}
                </li>
              ))}
            </ul>
            {pkg.audits[0]?.note ? (
              <p className="mt-2 text-xs opacity-60" data-testid={`package-audit-${pkg.id}`}>
                Audit: {pkg.audits[0].note}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {message ? (
        <p className="text-sm" data-testid="package-board-message">
          {message}
        </p>
      ) : null}
    </div>
  );
}
