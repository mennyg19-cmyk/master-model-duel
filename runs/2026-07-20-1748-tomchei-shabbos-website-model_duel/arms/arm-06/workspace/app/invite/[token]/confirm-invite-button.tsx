"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";

export function ConfirmInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function confirm() {
    setIsBusy(true);
    setError(null);
    const { ok, body } = await apiFetch<{ next?: string }>(`/api/invite/${token}`, { method: "POST" });
    if (!ok) {
      setError(body.error ?? "Could not confirm invite");
      setIsBusy(false);
      return;
    }
    router.push(body.next ?? "/admin");
    router.refresh();
  }

  return (
    <div className="mt-6">
      <Button onClick={confirm} disabled={isBusy}>
        {isBusy ? "Confirming…" : "Confirm and sign in"}
      </Button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
