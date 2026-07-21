"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function CheckoutSuccessInner() {
  const params = useSearchParams();
  const draft = params.get("draft");
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    if (!draft) {
      setStatus("error");
      setDetail("Missing draft");
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/checkout?draft=${encodeURIComponent(draft)}`);
      const json = await res.json();
      if (cancelled) return;
      if (!json.ok) {
        setStatus("ok");
        setDetail("Order placed. Thank you.");
        return;
      }
      const orderStatus = json.summary?.status;
      if (orderStatus === "DRAFT") {
        setStatus("error");
        setDetail("Payment not finalized yet.");
        return;
      }
      if (!json.summary?.customerId) {
        await fetch(`/api/drafts/${encodeURIComponent(draft)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "guest_success" }),
        });
      }
      setStatus("ok");
      setDetail(`Order ${json.summary?.draftRef ?? draft} is ${orderStatus}.`);
    })();
    return () => {
      cancelled = true;
    };
  }, [draft]);

  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center" data-testid="checkout-success">
      {status === "loading" ? <p>Confirming…</p> : null}
      {status === "ok" ? (
        <>
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
            Thank you
          </h1>
          <p className="mt-2" data-testid="success-detail">
            {detail}
          </p>
        </>
      ) : null}
      {status === "error" ? <p className="text-red-700">{detail}</p> : null}
      <Link href="/" className="mt-6 inline-block text-sm font-semibold">
        Home
      </Link>
    </main>
  );
}
