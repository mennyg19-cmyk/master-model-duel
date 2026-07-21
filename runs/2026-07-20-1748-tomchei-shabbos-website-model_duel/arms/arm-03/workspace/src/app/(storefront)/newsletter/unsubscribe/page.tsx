"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function UnsubscribeInner() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [message, setMessage] = useState("Working…");

  useEffect(() => {
    if (!token) {
      setMessage("Missing unsubscribe token.");
      return;
    }
    fetch("/api/newsletter/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const json = await res.json();
        setMessage(res.ok ? `Unsubscribed ${json.email}.` : json.error || "Could not unsubscribe.");
      })
      .catch(() => setMessage("Network error."));
  }, [token]);

  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
        Unsubscribe
      </h1>
      <p className="mt-4 text-sm" data-testid="unsubscribe-result">
        {message}
      </p>
    </main>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<main className="p-8 text-center text-sm">Loading…</main>}>
      <UnsubscribeInner />
    </Suspense>
  );
}
