"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StaffUser } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Badge, ROLE_TONES } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-fetch";

type StaffOption = Pick<StaffUser, "id" | "name" | "email" | "role">;

export function DevLoginForm({ staffUsers, next }: { staffUsers: StaffOption[]; next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function signInAs(staffUserId: string) {
    setPendingId(staffUserId);
    setError(null);
    const { ok, body } = await apiFetch("/api/dev-auth", {
      method: "POST",
      body: { staffUserId },
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
    <div className="mt-6 flex flex-col gap-2">
      {staffUsers.map((staff) => (
        <div
          key={staff.id}
          className="flex items-center justify-between rounded-md border border-stone-200 px-3 py-2"
        >
          <div>
            <div className="text-sm font-medium text-stone-900">{staff.name}</div>
            <div className="text-xs text-stone-500">{staff.email}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={ROLE_TONES[staff.role]}>{staff.role}</Badge>
            <Button size="sm" variant="secondary" disabled={pendingId !== null} onClick={() => signInAs(staff.id)}>
              Sign in
            </Button>
          </div>
        </div>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
