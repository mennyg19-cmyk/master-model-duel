"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LocalStripeCheckoutContent() {
  const sessionId = useSearchParams().get("session");
  const [state, setState] = useState<"ready" | "paying" | "paid" | "failed">("ready");
  const [message, setMessage] = useState("");

  async function pay() {
    setState("paying");
    const response = await fetch("/api/checkout/test-complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setState("failed");
      setMessage(payload.error ?? "Test payment failed.");
      return;
    }
    setState("paid");
    setMessage(`Payment captured for order ${payload.orderId}.`);
  }

  return (
    <main className="grid min-h-[70vh] place-items-center bg-[var(--cream)] px-5 py-16">
      <section className="w-full max-w-lg rounded-[2rem] border border-[var(--border)] bg-white p-8 shadow-xl">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
          Stripe test checkout
        </p>
        <h1 className="mt-3 font-serif text-4xl font-bold">Complete test payment</h1>
        <p className="mt-4 leading-7 text-[var(--muted)]">
          This local hosted page stands in for Stripe when test API keys are not configured.
          It is disabled in production.
        </p>
        {state === "paid" ? (
          <div className="mt-6 rounded-2xl bg-emerald-50 p-5 font-bold text-emerald-900">
            {message}
          </div>
        ) : (
          <button
            className="mt-7 w-full rounded-full bg-[var(--ink)] px-6 py-3 font-bold text-white disabled:opacity-60"
            disabled={!sessionId || state === "paying"}
            onClick={() => void pay()}
            type="button"
          >
            {state === "paying" ? "Capturing…" : "Pay in test mode"}
          </button>
        )}
        {state === "failed" && (
          <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800">{message}</p>
        )}
      </section>
    </main>
  );
}

export default function LocalStripeCheckoutPage() {
  return (
    <Suspense fallback={<main className="p-10 text-center font-bold">Loading checkout…</main>}>
      <LocalStripeCheckoutContent />
    </Suspense>
  );
}
