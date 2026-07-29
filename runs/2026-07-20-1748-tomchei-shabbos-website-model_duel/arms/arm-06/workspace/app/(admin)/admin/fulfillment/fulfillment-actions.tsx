"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { PackageStage } from "@prisma/client";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PackageStageBadge } from "@/components/admin/order-badges";

export interface ChannelPackageRow {
  id: string;
  recipientName: string;
  stage: PackageStage;
}

export interface FulfillmentChannel {
  channel: string;
  label: string;
  packages: ChannelPackageRow[];
}

// R-072: bulk stage advance per channel (checkboxes + one target stage), the
// manual nightly-batch trigger, and reprint-by-filing-group. Reprint-by-order
// lives on the order detail's Packages card. Illegal transitions come back as
// per-package skips, so a mixed selection never half-applies silently.
export function FulfillmentActions({
  channels,
  filingGroups,
}: {
  channels: FulfillmentChannel[];
  filingGroups: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [targets, setTargets] = useState<Record<string, PackageStage>>({});
  const [reprintGroup, setReprintGroup] = useState(filingGroups[0]?.key ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function toggle(channel: string, packageId: string) {
    const current = new Set(selected[channel] ?? []);
    if (current.has(packageId)) current.delete(packageId);
    else current.add(packageId);
    setSelected({ ...selected, [channel]: current });
  }

  async function run(label: string, fn: () => Promise<{ ok: boolean; body: { error?: string } }>) {
    setBusy(label);
    setError(null);
    setNote(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) {
      setError(result.body.error ?? "Action failed");
      return false;
    }
    router.refresh();
    return true;
  }

  async function bulkAdvance(event: FormEvent, channel: string) {
    event.preventDefault();
    const packageIds = [...(selected[channel] ?? [])];
    const to = targets[channel];
    if (packageIds.length === 0 || !to) {
      setError("Select at least one package and a target stage");
      return;
    }
    await run(`bulk-${channel}`, async () => {
      const result = await apiFetch<{ report?: { counts: { succeeded: number; skipped: number } } }>(
        "/api/admin/fulfillment/bulk",
        { method: "POST", body: { packageIds, to } },
      );
      if (result.ok) {
        const counts = result.body.report?.counts;
        setNote(
          counts
            ? `Bulk advance: ${counts.succeeded} advanced, ${counts.skipped} skipped (see audit trail for skip reasons).`
            : "Bulk advance applied.",
        );
        setSelected({ ...selected, [channel]: new Set() });
      }
      return result;
    });
  }

  async function runNightly() {
    await run("nightly", async () => {
      const result = await apiFetch<{ packageCount?: number; batches?: unknown[] }>(
        "/api/admin/fulfillment/print-batches",
        { method: "POST", body: {} },
      );
      if (result.ok) {
        setNote(
          `Nightly batch filed ${result.body.packageCount ?? 0} package(s) into ${result.body.batches?.length ?? 0} batch(es). Packages keep their stage — printing is not shipping.`,
        );
      }
      return result;
    });
  }

  async function reprint(event: FormEvent) {
    event.preventDefault();
    if (!reprintGroup) return;
    await run("reprint", async () => {
      const result = await apiFetch<{ batch?: { packageCount?: number } }>(
        "/api/admin/fulfillment/print-batches/reprint",
        { method: "POST", body: { filingGroup: reprintGroup } },
      );
      if (result.ok) {
        setNote(
          `Reprint batch created for ${reprintGroup} (${result.body.batch?.packageCount ?? 0} package(s)) — see Recent print batches for the PDFs.`,
        );
      }
      return result;
    });
  }

  return (
    <>
      <Card className="mt-4 p-4" data-print-actions>
        <CardTitle>Print batches</CardTitle>
        {error && (
          <p className="mt-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        {note && <p className="mt-2 text-sm text-green-800">{note}</p>}
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <Button size="sm" onClick={runNightly} disabled={busy !== null} data-run-nightly>
            {busy === "nightly" ? "Running…" : "Run nightly batch now"}
          </Button>
          <form onSubmit={reprint} className="flex items-end gap-2" data-reprint-form>
            <div>
              <Label htmlFor="reprint-group">Reprint filing group</Label>
              <Select id="reprint-group" className="mt-1" value={reprintGroup} onChange={(event) => setReprintGroup(event.target.value)}>
                {filingGroups.map((group) => (
                  <option key={group.key} value={group.key}>
                    {group.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="secondary" size="sm" disabled={busy !== null} data-reprint-submit>
              {busy === "reprint" ? "Reprinting…" : "Reprint group"}
            </Button>
          </form>
        </div>
      </Card>

      {channels.map((channel) => (
        <Card key={channel.channel} className="mt-4 p-4" data-bulk-card={channel.channel}>
          <CardTitle>{channel.label} — bulk advance</CardTitle>
          {channel.packages.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">No open packages in this channel.</p>
          ) : (
            <form onSubmit={(event) => bulkAdvance(event, channel.channel)} data-bulk-form={channel.channel}>
              <ul className="mt-2 grid gap-1 text-sm md:grid-cols-2 lg:grid-cols-3">
                {channel.packages.map((pkg) => (
                  <li key={pkg.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected[channel.channel]?.has(pkg.id) ?? false}
                      onChange={() => toggle(channel.channel, pkg.id)}
                      data-bulk-select={pkg.id}
                    />
                    <span className="truncate">{pkg.recipientName}</span>
                    <PackageStageBadge stage={pkg.stage} />
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div>
                  <Label htmlFor={`target-${channel.channel}`}>Advance selected to</Label>
                  <Select
                    id={`target-${channel.channel}`}
                    className="mt-1"
                    value={targets[channel.channel] ?? ""}
                    onChange={(event) => setTargets({ ...targets, [channel.channel]: event.target.value as PackageStage })}
                    data-bulk-target={channel.channel}
                  >
                    <option value="">Choose stage…</option>
                    {Object.values(PackageStage).map((stage) => (
                      <option key={stage} value={stage}>
                        {stage}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="submit" size="sm" disabled={busy !== null} data-bulk-submit={channel.channel}>
                  {busy === `bulk-${channel.channel}` ? "Advancing…" : `Advance selected (${selected[channel.channel]?.size ?? 0})`}
                </Button>
              </div>
            </form>
          )}
        </Card>
      ))}
    </>
  );
}
