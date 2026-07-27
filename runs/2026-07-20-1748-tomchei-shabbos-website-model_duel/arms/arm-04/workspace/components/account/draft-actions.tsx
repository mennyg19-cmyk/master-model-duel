"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** Continue / pay / cancel for the active draft (R-040). */
export function DraftActions({ hasUnassignedLines }: { hasUnassignedLines: boolean }) {
  const router = useRouter();
  const [isCancelling, setIsCancelling] = useState(false);

  async function cancelDraft() {
    if (!confirm("Discard this draft order? The items in it will be removed.")) return;
    setIsCancelling(true);
    await fetch("/api/draft", { method: "DELETE" });
    setIsCancelling(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Link
        href="/order"
        className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong"
      >
        Continue building
      </Link>
      {!hasUnassignedLines && (
        <Link
          href="/checkout"
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-brand-soft"
        >
          Pay
        </Link>
      )}
      <Button variant="danger" onClick={cancelDraft} disabled={isCancelling} data-testid="cancel-draft">
        {isCancelling ? "Cancelling…" : "Cancel draft"}
      </Button>
    </div>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        await fetch("/api/account/logout", { method: "POST" });
        router.push("/");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
