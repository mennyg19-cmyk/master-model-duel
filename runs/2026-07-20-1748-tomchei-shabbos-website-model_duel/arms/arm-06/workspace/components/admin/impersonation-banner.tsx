"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";

export function ImpersonationBanner({
  targetEmail,
  impersonatorEmail,
}: {
  targetEmail: string;
  impersonatorEmail: string;
}) {
  const router = useRouter();
  const [isStopping, setIsStopping] = useState(false);

  async function stopImpersonation() {
    setIsStopping(true);
    await apiFetch("/api/admin/impersonation/stop", { method: "POST" });
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between gap-4 bg-accent-500 px-4 py-2 text-sm text-stone-900">
      <span>
        Viewing as <strong>{targetEmail}</strong> (impersonated by {impersonatorEmail}). Actions
        are audited under the impersonator.
      </span>
      <Button size="sm" variant="secondary" onClick={stopImpersonation} disabled={isStopping}>
        {isStopping ? "Stopping…" : "Stop impersonating"}
      </Button>
    </div>
  );
}
