"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { useHubAct } from "@/components/admin/use-hub-act";

/** Test-console actions (R-103): wipe / seed / wipe+reseed the open test season. */
export function TestConsoleClient() {
  const { message, act } = useHubAct();
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  const run = (action: "wipe" | "seed" | "reseed", label: string) =>
    act(async () => {
      const result = await apiFetch<Record<string, unknown>>("/api/admin/test-console", {
        method: "POST",
        body: { action },
      });
      if (result.ok) setDetail(result.body);
      return result;
    }, label);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" data-testid="test-wipe" onClick={() => run("wipe", "Season wiped.")}>
          Wipe open season
        </Button>
        <Button variant="secondary" data-testid="test-seed" onClick={() => run("seed", "Demo order seeded.")}>
          Seed demo order
        </Button>
        <Button data-testid="test-reseed" onClick={() => run("reseed", "Season wiped and reseeded.")}>
          Wipe + reseed
        </Button>
      </div>
      {message && <p className="mt-3 text-sm" data-testid="test-console-message">{message}</p>}
      {detail && (
        <pre className="mt-3 max-h-64 overflow-auto rounded-md border border-border bg-white p-3 text-xs">
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
    </div>
  );
}
