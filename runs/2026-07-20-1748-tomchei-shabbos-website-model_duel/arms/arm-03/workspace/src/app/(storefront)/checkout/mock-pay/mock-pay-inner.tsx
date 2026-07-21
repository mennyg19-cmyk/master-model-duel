"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function MockPayInner() {
  const params = useSearchParams();
  const router = useRouter();
  const sessionId = params.get("session_id");
  const draft = params.get("draft");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !draft) {
      setError("Missing session");
      return;
    }
    let cancelled = false;
    (async () => {
      const prep = await fetch(`/api/checkout?draft=${encodeURIComponent(draft)}`);
      const prepJson = await prep.json();
      if (!prepJson.ok) {
        if (!cancelled) setError(prepJson.error || "Draft not found");
        return;
      }
      const orderId = prepJson.summary.orderId;
      const amountCents = prepJson.summary.totalCents;
      const complete = await fetch("/api/checkout/mock-complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, orderId, draftRef: draft, amountCents }),
      });
      const json = await complete.json();
      if (!json.ok) {
        if (!cancelled) setError(json.error || "Mock pay failed");
        return;
      }
      if (!cancelled) {
        router.replace(
          `/checkout/success?session_id=${sessionId}&draft=${encodeURIComponent(draft)}`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, draft, router]);

  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center" data-testid="mock-pay">
      {error ? <p className="text-red-700">{error}</p> : <p>Processing mock Stripe payment…</p>}
    </main>
  );
}
