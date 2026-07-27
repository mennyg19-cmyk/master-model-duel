"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function StopImpersonationButton() {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        await fetch("/api/impersonate", { method: "DELETE" });
        router.refresh();
      }}
    >
      Stop impersonating
    </Button>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="text-xs text-muted hover:text-danger hover:underline"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
      }}
    >
      Sign out
    </button>
  );
}
