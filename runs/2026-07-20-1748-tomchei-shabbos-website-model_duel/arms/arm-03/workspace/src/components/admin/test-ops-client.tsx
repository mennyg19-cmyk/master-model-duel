"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function TestOpsClient() {
  const [enabled, setEnabled] = useState(false);
  const [scaleOrders, setScaleOrders] = useState(0);
  const [packageCount, setPackageCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/test-ops");
    const json = await res.json();
    if (res.ok) {
      setEnabled(Boolean(json.testMode?.enabled));
      setScaleOrders(json.scaleOrders ?? 0);
      setPackageCount(json.packageCount ?? 0);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function post(body: Record<string, unknown>) {
    setMessage(null);
    const res = await fetch("/api/admin/test-ops", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "Test-ops failed");
      return;
    }
    setMessage(JSON.stringify(json));
    await load();
  }

  return (
    <div className="space-y-4" data-testid="test-ops-console">
      <p className="text-sm opacity-80" data-testid="test-ops-stats">
        Test mode: {enabled ? "ON" : "OFF"} · scale orders {scaleOrders} · packages {packageCount}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => void post({ action: "setTestMode", enabled: !enabled })}
          data-testid="test-ops-toggle"
        >
          {enabled ? "Disable test mode" : "Enable test mode"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void post({ action: "dressRehearsal" })}
          data-testid="test-ops-dress"
        >
          Run dress rehearsal
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void post({ action: "scalePrintProbe" })}
          data-testid="test-ops-scale-print"
        >
          Scale print probe
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void post({ action: "wipe" })}
          data-testid="test-ops-wipe"
        >
          Wipe test fixtures
        </Button>
      </div>
      {message ? (
        <pre className="overflow-auto rounded bg-white p-3 text-xs shadow-sm" data-testid="test-ops-message">
          {message}
        </pre>
      ) : null}
    </div>
  );
}
