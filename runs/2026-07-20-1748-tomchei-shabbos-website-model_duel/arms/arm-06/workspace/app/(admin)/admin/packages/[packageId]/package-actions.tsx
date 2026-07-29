"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { PackageStage } from "@prisma/client";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export interface PackageLineRow {
  orderLineId: string;
  label: string;
  qty: number;
}

export interface PackageSiblingRow {
  id: string;
  label: string;
}

type MoveQtys = Record<string, number>;

function movesFrom(lines: PackageLineRow[], qtys: MoveQtys): { orderLineId: string; qty: number }[] {
  return lines
    .map((line) => ({ orderLineId: line.orderLineId, qty: Math.min(Math.max(0, Math.floor(qtys[line.orderLineId] ?? 0)), line.qty) }))
    .filter((move) => move.qty > 0);
}

// UR-001/G-003: stage advance (forward-only inside the method's stage list),
// split into a new box, regroup into another box of the same order. Every
// action sends the loaded version for optimistic concurrency; the server
// re-checks everything, and the page refreshes on success.
export function PackageActions({
  packageId,
  version,
  stage,
  nextStages,
  lines,
  siblings,
}: {
  packageId: string;
  version: number;
  stage: PackageStage;
  nextStages: PackageStage[];
  lines: PackageLineRow[];
  siblings: PackageSiblingRow[];
}) {
  const router = useRouter();
  const [advanceTo, setAdvanceTo] = useState<PackageStage | "">(nextStages[0] ?? "");
  const [splitQtys, setSplitQtys] = useState<MoveQtys>({});
  const [regroupQtys, setRegroupQtys] = useState<MoveQtys>({});
  const [targetId, setTargetId] = useState(siblings[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<{ ok: boolean; body: { error?: string }; navigateTo?: string }>) {
    setBusy(label);
    setError(null);
    setNote(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) {
      setError(result.body.error ?? "Action failed");
      return;
    }
    setSplitQtys({});
    setRegroupQtys({});
    // An absorbed regroup deletes this page's package: refreshing would land
    // on notFound(), so navigate to the board instead.
    if (result.navigateTo) router.push(result.navigateTo);
    else router.refresh();
  }

  async function advance(event: FormEvent) {
    event.preventDefault();
    if (!advanceTo) return;
    await run("advance", () =>
      apiFetch(`/api/admin/packages/${packageId}/advance`, { method: "POST", body: { expectedVersion: version, to: advanceTo } }),
    );
  }

  async function split(event: FormEvent) {
    event.preventDefault();
    const moves = movesFrom(lines, splitQtys);
    if (moves.length === 0) {
      setError("Enter at least one quantity to move into the new package");
      return;
    }
    await run("split", async () => {
      const result = await apiFetch<{ newPackageId?: string }>(`/api/admin/packages/${packageId}/split`, {
        method: "POST",
        body: { expectedVersion: version, moves },
      });
      if (result.ok) setNote("Split created a new package — see the board for both boxes.");
      return result;
    });
  }

  async function regroup(event: FormEvent) {
    event.preventDefault();
    const moves = movesFrom(lines, regroupQtys);
    if (!targetId) {
      setError("Choose a target package");
      return;
    }
    if (moves.length === 0) {
      setError("Enter at least one quantity to move");
      return;
    }
    await run("regroup", async () => {
      const result = await apiFetch<{ absorbed?: boolean }>(`/api/admin/packages/${packageId}/regroup`, {
        method: "POST",
        body: { expectedVersion: version, targetPackageId: targetId, moves },
      });
      if (result.ok) {
        setNote(
          result.body.absorbed
            ? "All lines moved — this package was absorbed into the target."
            : "Lines moved into the target package.",
        );
      }
      return { ...result, navigateTo: result.ok && result.body.absorbed ? "/admin/packages" : undefined };
    });
  }

  if (nextStages.length === 0 && siblings.length === 0) {
    return (
      <Card className="mt-6 p-5">
        <CardTitle>Actions</CardTitle>
        <p className="mt-2 text-sm text-stone-600">
          {stage} is terminal for this method and no sibling packages exist — nothing left to do here.
        </p>
      </Card>
    );
  }

  return (
    <Card className="mt-6 p-5" data-package-actions>
      <CardTitle>Actions</CardTitle>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {note && <p className="mt-2 text-sm text-green-800">{note}</p>}

      {nextStages.length > 0 && (
        <form onSubmit={advance} className="mt-4 flex flex-wrap items-end gap-3" data-advance-form>
          <div>
            <Label htmlFor="advance-to">Advance stage</Label>
            <Select
              id="advance-to"
              className="mt-1"
              value={advanceTo}
              onChange={(event) => setAdvanceTo(event.target.value as PackageStage)}
            >
              {nextStages.map((next) => (
                <option key={next} value={next}>
                  {next}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" size="sm" disabled={busy !== null} data-advance-submit>
            {busy === "advance" ? "Advancing…" : "Advance"}
          </Button>
        </form>
      )}

      <div className="mt-5 grid gap-6 border-t border-stone-200 pt-4 lg:grid-cols-2">
        <form onSubmit={split} data-split-form>
          <p className="text-sm font-medium text-stone-900">Split into a new package</p>
          <p className="mt-1 text-xs text-stone-500">Quantities move into a second box with the same recipient and method; at least one unit must stay here.</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {lines.map((line) => (
              <li key={line.orderLineId} className="flex items-center gap-2 text-sm">
                <Input
                  type="number"
                  min={0}
                  max={line.qty}
                  className="w-20"
                  value={splitQtys[line.orderLineId] ?? 0}
                  onChange={(event) => setSplitQtys({ ...splitQtys, [line.orderLineId]: Number(event.target.value) })}
                  data-split-qty={line.orderLineId}
                />
                <span className="text-stone-600">
                  of {line.qty} × {line.label}
                </span>
              </li>
            ))}
          </ul>
          <Button type="submit" variant="secondary" size="sm" className="mt-3" disabled={busy !== null} data-split-submit>
            {busy === "split" ? "Splitting…" : "Split"}
          </Button>
        </form>

        {siblings.length > 0 && (
          <form onSubmit={regroup} data-regroup-form>
            <p className="text-sm font-medium text-stone-900">Regroup into another package of this order</p>
            <p className="mt-1 text-xs text-stone-500">Moving every unit absorbs this package into the target.</p>
            <div className="mt-2">
              <Label htmlFor="regroup-target">Target package</Label>
              <Select id="regroup-target" className="mt-1" value={targetId} onChange={(event) => setTargetId(event.target.value)} data-regroup-target>
                {siblings.map((sibling) => (
                  <option key={sibling.id} value={sibling.id}>
                    {sibling.label}
                  </option>
                ))}
              </Select>
            </div>
            <ul className="mt-2 flex flex-col gap-1.5">
              {lines.map((line) => (
                <li key={line.orderLineId} className="flex items-center gap-2 text-sm">
                  <Input
                    type="number"
                    min={0}
                    max={line.qty}
                    className="w-20"
                    value={regroupQtys[line.orderLineId] ?? 0}
                    onChange={(event) => setRegroupQtys({ ...regroupQtys, [line.orderLineId]: Number(event.target.value) })}
                    data-regroup-qty={line.orderLineId}
                  />
                  <span className="text-stone-600">
                    of {line.qty} × {line.label}
                  </span>
                </li>
              ))}
            </ul>
            <Button type="submit" variant="secondary" size="sm" className="mt-3" disabled={busy !== null} data-regroup-submit>
              {busy === "regroup" ? "Regrouping…" : "Regroup"}
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}
