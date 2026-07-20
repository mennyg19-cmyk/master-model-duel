"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MockPayButtons({
  sessionId,
  successUrl,
  cancelUrl,
}: {
  sessionId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "paying" | "error">("idle");

  async function pay() {
    setState("paying");
    const response = await fetch("/api/dev/stripe-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    if (!response.ok) {
      setState("error");
      return;
    }
    router.push(successUrl);
  }

  return (
    <div className="mt-6 flex flex-col gap-2">
      <button
        type="button"
        onClick={pay}
        disabled={state === "paying"}
        className="rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
        data-testid="mock-pay"
      >
        {state === "paying" ? "Processing…" : "Pay"}
      </button>
      <button
        type="button"
        onClick={() => router.push(cancelUrl)}
        className="rounded-md border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
      >
        Cancel and return
      </button>
      {state === "error" && <p className="text-sm text-red-600">Payment failed — try again.</p>}
    </div>
  );
}
