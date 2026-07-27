"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LocalCheckoutFlow() {
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("This local test harness never contacts Stripe.");

  async function complete() {
    const sessionId = searchParams.get("session_id");
    const response = await fetch("/api/checkout/local", {
      method: "POST",
      headers: { "content-type": "application/json", origin: window.location.origin },
      body: JSON.stringify({ sessionId }),
    });
    const body = await response.json() as { error?: string };
    setMessage(response.ok ? "Payment captured locally. Your order is confirmed." : body.error ?? "Local payment could not complete.");
  }

  return <main><p className="eyebrow">Local checkout harness</p><h1>Confirm test payment</h1><p role="status">{message}</p><button className="button" onClick={() => void complete()} type="button">Confirm local test payment</button></main>;
}

export default function LocalCheckoutPage() {
  return <Suspense fallback={<main><p>Loading local checkout…</p></main>}><LocalCheckoutFlow /></Suspense>;
}
