"use client";

import { useEffect, useState } from "react";

export default function TestConsolePage() {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void fetch("/api/admin/test-console").then(async (response) => {
      const body = await response.json();
      setEnabled(response.ok && body.testMode === true);
      if (!response.ok) setMessage(body.error ?? "The test console is unavailable.");
    });
  }, []);

  async function run(action: "seed" | "wipe" | "reset") {
    if (action !== "seed" && !window.confirm(`This will ${action} test data. Continue?`)) return;
    const response = await fetch("/api/admin/test-console", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const body = await response.json();
    setMessage(response.ok ? `Test data ${body.completed}.` : body.error ?? "The test action failed.");
  }

  return (
    <>
      <p className="eyebrow">Test environment</p>
      <h1>Dress rehearsal console</h1>
      <p className="lead">These destructive controls exist only with TEST_MODE=true outside production. Use reset before each 1k-order / 5k-package rehearsal.</p>
      <section className="card">
        <h2>{enabled ? "Test mode enabled" : "Test mode disabled"}</h2>
        <p>Seed restores the base fixture. Wipe removes all test data. Reset wipes and then seeds a clean season.</p>
        {enabled && <p><button className="button secondary" onClick={() => void run("seed")} type="button">Seed</button><button className="button secondary" onClick={() => void run("wipe")} type="button">Wipe</button><button className="button" onClick={() => void run("reset")} type="button">Wipe and reseed</button></p>}
      </section>
      {message && <p className="notice" role="status">{message}</p>}
    </>
  );
}
