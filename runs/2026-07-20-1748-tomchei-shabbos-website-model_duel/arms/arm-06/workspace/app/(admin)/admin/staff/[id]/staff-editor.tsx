"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OverrideEffect, PermissionOverride, StaffRole, StaffUser } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-fetch";
import { PERMISSIONS } from "@/lib/permissions";

// Mirrors the server page's serialized projection.
type EditableStaff = Pick<StaffUser, "id" | "email" | "role" | "status" | "version" | "inviteToken"> & {
  overrides: Pick<PermissionOverride, "permission" | "effect">[];
};

const ROLES: StaffRole[] = ["MANAGER", "STAFF", "DRIVER"];

export function StaffEditor({
  staff,
  isSelf,
  canImpersonate,
}: {
  staff: EditableStaff;
  isSelf: boolean;
  canImpersonate: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [role, setRole] = useState<StaffRole>(staff.role);
  const [effects, setEffects] = useState<Record<string, OverrideEffect | "INHERIT">>(() => {
    const initial: Record<string, OverrideEffect | "INHERIT"> = {};
    for (const permission of PERMISSIONS) {
      initial[permission] =
        staff.overrides.find((entry) => entry.permission === permission)?.effect ?? "INHERIT";
    }
    return initial;
  });

  async function patch(payload: Record<string, unknown>): Promise<boolean> {
    setIsBusy(true);
    setError(null);
    setNotice(null);
    const { ok, status, body } = await apiFetch(`/api/admin/staff/${staff.id}`, {
      method: "PATCH",
      body: payload,
    });
    setIsBusy(false);
    if (!ok) {
      setError(body.error ?? "Save failed");
      if (status === 409) router.refresh();
      return false;
    }
    setNotice("Saved.");
    router.refresh();
    return true;
  }

  async function saveRole() {
    await patch({ version: staff.version, role });
  }

  async function saveOverrides() {
    await patch({
      version: staff.version,
      overrides: PERMISSIONS.map((permission) => ({
        permission,
        effect: effects[permission] === "INHERIT" ? null : effects[permission],
      })),
    });
  }

  async function impersonate() {
    setIsBusy(true);
    setError(null);
    const { ok, body } = await apiFetch(`/api/admin/staff/${staff.id}/impersonate`, { method: "POST" });
    setIsBusy(false);
    if (!ok) {
      setError(body.error ?? "Impersonation failed");
      return;
    }
    router.refresh();
  }

  async function revoke() {
    if (!window.confirm(`Revoke ${staff.email}? They will immediately lose access.`)) return;
    setIsBusy(true);
    setError(null);
    const { ok, body } = await apiFetch(`/api/admin/staff/${staff.id}/revoke`, { method: "POST" });
    setIsBusy(false);
    if (!ok) {
      setError(body.error ?? "Revoke failed");
      return;
    }
    router.push("/admin/staff");
    router.refresh();
  }

  return (
    <div className="mt-6 flex flex-col gap-8">
      <section>
        <h2 className="text-sm font-semibold text-stone-900">Role</h2>
        <div className="mt-2 flex items-end gap-2">
          <div className="w-56">
            <Label htmlFor="role">Role</Label>
            <Select
              id="role"
              value={role}
              disabled={isSelf || staff.status !== "ACTIVE"}
              onChange={(event) => setRole(event.target.value as StaffRole)}
            >
              {ROLES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={saveRole} disabled={isBusy || isSelf || role === staff.role}>
            Save role
          </Button>
          {isSelf && <span className="text-xs text-stone-500">You cannot change your own role.</span>}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-stone-900">Permission overrides</h2>
        <p className="mt-1 text-xs text-stone-500">
          Deny beats grant beats role default. Audit records the full before/after.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {PERMISSIONS.map((permission) => (
            <div key={permission} className="flex items-center gap-3">
              <code className="w-44 text-sm">{permission}</code>
              <Select
                value={effects[permission]}
                disabled={staff.status !== "ACTIVE"}
                onChange={(event) =>
                  setEffects((prev) => ({
                    ...prev,
                    [permission]: event.target.value as OverrideEffect | "INHERIT",
                  }))
                }
                className="w-44"
              >
                <option value="INHERIT">Inherit from role</option>
                <option value="GRANT">Grant</option>
                <option value="DENY">Deny</option>
              </Select>
            </div>
          ))}
        </div>
        <Button className="mt-3" onClick={saveOverrides} disabled={isBusy || staff.status !== "ACTIVE"}>
          Save overrides
        </Button>
      </section>

      <section className="flex items-center gap-3 border-t border-stone-200 pt-4">
        {canImpersonate && !isSelf && staff.status === "ACTIVE" && (
          <Button variant="secondary" onClick={impersonate} disabled={isBusy}>
            Impersonate
          </Button>
        )}
        {!isSelf && staff.status === "ACTIVE" && (
          <Button variant="danger" onClick={revoke} disabled={isBusy}>
            Revoke account
          </Button>
        )}
        {staff.status !== "ACTIVE" && <Badge tone="stone">{staff.status}</Badge>}
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-green-700">{notice}</p>}
    </div>
  );
}
