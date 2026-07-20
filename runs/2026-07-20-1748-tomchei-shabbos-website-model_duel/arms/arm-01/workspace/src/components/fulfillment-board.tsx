"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type PackageRow = {
  id: string;
  orderId: string;
  orderLabel: string;
  recipientName: string;
  method: string;
  stage: string;
  version: number;
  lines: { id: string; label: string; quantity: number }[];
};

type ArtifactRow = {
  id: string;
  label: string;
};

export function FulfillmentBoard({
  packages,
  filingGroups,
  orders,
  artifacts,
}: {
  packages: PackageRow[];
  filingGroups: string[];
  orders: { id: string; label: string }[];
  artifacts: ArtifactRow[];
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStage, setBulkStage] = useState("PRINTED");
  const [sourcePackageId, setSourcePackageId] = useState("");
  const [targetPackageId, setTargetPackageId] = useState("");
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function post(path: string, body: unknown, success: string) {
    setIsBusy(true);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        applied?: string[];
        conflicts?: { packageId: string; reason: string }[];
        error?: string;
      };
      if (!response.ok) {
        setMessage(payload.error ?? "The package action failed.");
        return;
      }
      const conflicts = payload.conflicts ?? [];
      setMessage(
        conflicts.length
          ? `${payload.applied?.length ?? 0} package(s) changed; ${conflicts.length} not changed: ${conflicts
              .map(
                (conflict) =>
                  `${conflict.packageId.slice(-6)} — ${conflict.reason}`,
              )
              .join(" ")}`
          : success,
      );
      router.refresh();
    } catch {
      setMessage("The package action could not reach the server.");
    } finally {
      setIsBusy(false);
    }
  }

  async function split(packageId: string, packageLineId: string, formData: FormData) {
    await post(
      "/api/admin/packages/actions",
      {
        action: "split",
        packageId,
        packageLineId,
        quantity: Number(formData.get("quantity")),
      },
      "Package split; both packages remain independently printable.",
    );
  }

  async function advanceSelected() {
    const selectedPackages = packages
      .filter((entry) => selectedIds.includes(entry.id))
      .map((entry) => ({
        packageId: entry.id,
        version: entry.version,
        stage: bulkStage,
      }));
    if (!selectedPackages.length) {
      setMessage("Select at least one package.");
      return;
    }
    await post(
      "/api/admin/packages/actions",
      { action: "status", packages: selectedPackages },
      `Selected packages advanced to ${bulkStage}.`,
    );
  }

  async function createPrintBatch(body: unknown, success: string) {
    await post("/api/admin/print-batches", body, success);
  }

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <div className="flex flex-wrap items-end gap-3">
          <button
            className="rounded-xl border border-[var(--brand)] px-5 py-2.5 font-bold text-[var(--brand-dark)] disabled:opacity-50"
            disabled={isBusy}
            onClick={() =>
              void post(
                "/api/admin/packages/actions",
                { action: "materialize" },
                "Missing finalized orders checked and packages created.",
              )
            }
            type="button"
          >
            Create missing packages
          </button>
          <div>
            <label className="text-sm font-bold" htmlFor="bulk-stage">
              Bulk status
            </label>
            <select
              className="mt-1 block rounded-xl border border-[var(--border)] px-3 py-2"
              id="bulk-stage"
              onChange={(event) => setBulkStage(event.target.value)}
              value={bulkStage}
            >
              <option value="PRINTED">Printed</option>
              <option value="PACKED">Packed</option>
              <option value="SENT">Sent</option>
              <option value="PICKED_UP">Picked up</option>
            </select>
          </div>
          <button
            className="rounded-xl bg-[var(--ink)] px-5 py-2.5 font-bold text-white disabled:opacity-50"
            disabled={isBusy}
            onClick={() => void advanceSelected()}
            type="button"
          >
            Apply to selected
          </button>
          <p className="text-sm text-[var(--muted)]">
            Printing PDFs does not change these statuses.
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-black">Package board</h2>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {packages.map((entry) => (
            <article
              className="rounded-3xl border border-[var(--border)] bg-white p-5"
              key={entry.id}
            >
              <div className="flex items-start justify-between gap-4">
                <label className="flex items-start gap-3">
                  <input
                    checked={selectedIds.includes(entry.id)}
                    className="mt-1 size-4"
                    onChange={(event) =>
                      setSelectedIds((current) =>
                        event.target.checked
                          ? [...current, entry.id]
                          : current.filter((id) => id !== entry.id),
                      )
                    }
                    type="checkbox"
                  />
                  <span>
                    <span className="block font-black">{entry.orderLabel}</span>
                    <span className="block text-sm text-[var(--muted)]">
                      {entry.recipientName} · {entry.method}
                    </span>
                  </span>
                </label>
                <span className="rounded-full bg-[var(--brand-soft)] px-3 py-1 text-xs font-black">
                  {entry.stage}
                </span>
              </div>
              <div className="mt-4 divide-y divide-[var(--border)]">
                {entry.lines.map((line) => (
                  <div className="py-3" key={line.id}>
                    <p className="font-semibold">
                      {line.quantity} × {line.label}
                    </p>
                    {(line.quantity > 1 || entry.lines.length > 1) && (
                      <form
                        action={split.bind(null, entry.id, line.id)}
                        className="mt-2 flex items-center gap-2"
                      >
                        <input
                          className="w-20 rounded-lg border border-[var(--border)] px-2 py-1"
                          defaultValue="1"
                          max={line.quantity}
                          min="1"
                          name="quantity"
                          type="number"
                        />
                        <button
                          className="rounded-lg border border-[var(--brand)] px-3 py-1 text-sm font-bold text-[var(--brand-dark)]"
                          disabled={isBusy}
                        >
                          Split
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-3 break-all text-xs text-[var(--muted)]">
                Package {entry.id}
              </p>
            </article>
          ))}
          {!packages.length && (
            <p className="rounded-3xl border border-dashed border-[var(--border)] p-8 text-center text-[var(--muted)]">
              No active packages are waiting for fulfillment.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-xl font-black">Regroup packages</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Move all contents from one package into another package on the same order.
          The source package and its audit remain retained.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <select
            className="rounded-xl border border-[var(--border)] px-3 py-2"
            onChange={(event) => setSourcePackageId(event.target.value)}
            value={sourcePackageId}
          >
            <option value="">Source package</option>
            {packages.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.orderLabel} · {entry.recipientName} · {entry.id.slice(-6)}
              </option>
            ))}
          </select>
          <select
            className="rounded-xl border border-[var(--border)] px-3 py-2"
            onChange={(event) => setTargetPackageId(event.target.value)}
            value={targetPackageId}
          >
            <option value="">Target package</option>
            {packages.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.orderLabel} · {entry.recipientName} · {entry.id.slice(-6)}
              </option>
            ))}
          </select>
          <button
            className="rounded-xl bg-[var(--ink)] px-5 py-2 font-bold text-white disabled:opacity-50"
            disabled={isBusy || !sourcePackageId || !targetPackageId}
            onClick={() =>
              void post(
                "/api/admin/packages/actions",
                { action: "regroup", sourcePackageId, targetPackageId },
                "Packages regrouped with audit retained.",
              )
            }
            type="button"
          >
            Regroup
          </button>
        </div>
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-xl font-black">Print production</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Nightly runs are idempotent by date. Reprints create only the selected
          filing group or order artifacts.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            className="rounded-xl bg-[var(--brand)] px-5 py-2.5 font-bold text-white"
            disabled={isBusy}
            onClick={() =>
              void createPrintBatch(
                {
                  action: "nightly",
                  dateKey: new Date().toISOString().slice(0, 10),
                },
                "Nightly print batch is ready; package statuses are unchanged.",
              )
            }
            type="button"
          >
            Run nightly batch
          </button>
          {filingGroups.map((group) => (
            <button
              className="rounded-xl border border-[var(--border)] px-4 py-2 font-bold"
              disabled={isBusy}
              key={group}
              onClick={() =>
                void createPrintBatch(
                  { action: "reprint-group", filingGroup: group },
                  `${group} reprint created without unrelated groups.`,
                )
              }
              type="button"
            >
              Reprint {group}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {orders.slice(0, 12).map((order) => (
            <button
              className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-bold"
              disabled={isBusy}
              key={order.id}
              onClick={() =>
                void createPrintBatch(
                  { action: "reprint-order", orderId: order.id },
                  `${order.label} reprint created without unrelated orders.`,
                )
              }
              type="button"
            >
              Reprint {order.label}
            </button>
          ))}
        </div>
        {artifacts.length > 0 && (
          <div className="mt-6 border-t border-[var(--border)] pt-5">
            <h3 className="font-black">Recent PDFs</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {artifacts.map((artifact) => (
                <a
                  className="rounded-lg bg-[var(--surface)] px-3 py-2 text-sm font-bold text-[var(--brand-dark)]"
                  href={`/api/admin/print-artifacts/${artifact.id}`}
                  key={artifact.id}
                  target="_blank"
                >
                  {artifact.label}
                </a>
              ))}
            </div>
          </div>
        )}
      </section>
      {message && (
        <p
          aria-live="polite"
          className="sticky bottom-4 rounded-xl bg-[var(--ink)] p-4 font-semibold text-white shadow-xl"
        >
          {message}
        </p>
      )}
    </div>
  );
}
