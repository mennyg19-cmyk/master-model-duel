"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";

type CustomerOption = { id: string; name: string; email: string };

// Dev-seam customer sign-in (mirrors DevLoginForm for staff). Real customer
// auth is Clerk's slot; every customer gate still checks the server session.
export function DevCustomerLoginForm({ customers, next }: { customers: CustomerOption[]; next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function signInAs(customerId: string) {
    setPendingId(customerId);
    setError(null);
    const { ok, body } = await apiFetch("/api/dev-auth-customer", {
      method: "POST",
      body: { customerId },
    });
    if (!ok) {
      setError(body.error ?? "Sign in failed");
      setPendingId(null);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      {customers.map((customer) => (
        <div
          key={customer.id}
          className="flex items-center justify-between rounded-md border border-stone-200 px-3 py-2"
        >
          <div>
            <div className="text-sm font-medium text-stone-900">{customer.name}</div>
            <div className="text-xs text-stone-500">{customer.email}</div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={pendingId !== null}
            onClick={() => signInAs(customer.id)}
          >
            Sign in
          </Button>
        </div>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
