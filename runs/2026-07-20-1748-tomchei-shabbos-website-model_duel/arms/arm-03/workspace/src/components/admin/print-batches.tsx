"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Artifact = {
  id: string;
  filingGroup: string;
  kind: string;
  orderId: string | null;
};

type Batch = {
  id: string;
  kind: string;
  runKey: string;
  createdAt: string;
  _count: { artifacts: number };
  artifacts: Artifact[];
  season: { name: string; year: number };
};

export function PrintBatchesClient() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [filingGroup, setFilingGroup] = useState("SHIP");
  const [orderId, setOrderId] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/print-batches");
    const json = await res.json();
    if (res.ok) setBatches(json.batches ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function run(body: Record<string, unknown>) {
    setMessage(null);
    const res = await fetch("/api/admin/print-batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "Print batch failed");
      return;
    }
    const stages = (json.packageStages ?? []) as Array<{ id: string; stage: string }>;
    const unshipped = stages.every((s) => s.stage !== "SENT" && s.stage !== "PICKED_UP");
    setMessage(
      `${body.action}: batch ${json.batchId?.slice(0, 8)} · created=${json.created ?? true} · artifacts=${json.artifactCount} · stagesUnchanged=${json.stagesUnchanged} · stillUnshipped=${unshipped}`,
    );
    await load();
  }

  return (
    <div className="space-y-4" data-testid="print-batches">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void run({ action: "nightly" })} data-testid="print-nightly">
          Run nightly batch
        </Button>
        <input
          className="rounded border px-2 py-1.5 text-sm"
          value={filingGroup}
          onChange={(e) => setFilingGroup(e.target.value)}
          data-testid="print-filing-group"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => void run({ action: "reprint-group", filingGroup })}
          data-testid="print-reprint-group"
        >
          Reprint group
        </Button>
        <input
          className="rounded border px-2 py-1.5 text-sm"
          placeholder="Order id"
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          data-testid="print-order-id"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => void run({ action: "reprint-order", orderId })}
          data-testid="print-reprint-order"
        >
          Reprint order
        </Button>
      </div>

      <p className="text-xs opacity-70">
        Printing generates PDFs only — package stage stays unchanged until staff marks Printed/Packed/Sent.
      </p>

      {message ? (
        <p className="text-sm" data-testid="print-batches-message">
          {message}
        </p>
      ) : null}

      <ul className="space-y-3" data-testid="print-batch-list">
        {batches.map((batch) => (
          <li key={batch.id} className="rounded bg-white p-4 shadow-sm" data-testid={`print-batch-${batch.id}`}>
            <p className="text-sm font-semibold">
              {batch.kind} · {batch.runKey}
            </p>
            <p className="text-xs opacity-70">
              {batch.season.name} {batch.season.year} · {batch._count.artifacts} artifacts ·{" "}
              {new Date(batch.createdAt).toLocaleString()}
            </p>
            <ul className="mt-2 space-y-1 text-xs">
              {batch.artifacts.map((a) => (
                <li key={a.id}>
                  <a
                    className="underline"
                    href={`/api/admin/print-batches/artifacts/${a.id}`}
                    target="_blank"
                    rel="noreferrer"
                    data-testid={`print-artifact-${a.id}`}
                  >
                    {a.kind} / {a.filingGroup}
                    {a.orderId ? ` / order ${a.orderId.slice(0, 8)}` : ""}
                  </a>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
