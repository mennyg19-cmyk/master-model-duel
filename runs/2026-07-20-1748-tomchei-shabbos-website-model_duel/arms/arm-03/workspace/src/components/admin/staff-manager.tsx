"use client";

import { useState } from "react";
import { PermissionEffect, StaffRole } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PERMISSIONS, permissionLabels, type Permission } from "@/lib/permissions";

type StaffRow = {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  version: number;
  isActive: boolean;
  revokedAt: string | null;
  permissionOverrides: { permission: string; effect: PermissionEffect }[];
};

export function StaffManager({ initialStaff }: { initialStaff: StaffRow[] }) {
  const [staff, setStaff] = useState(initialStaff);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<StaffRole>(StaffRole.STAFF);
  const [message, setMessage] = useState("");

  async function refresh() {
    const res = await fetch("/api/staff");
    const json = await res.json();
    if (json.ok) setStaff(json.staff);
  }

  async function addStaff(event: React.FormEvent) {
    event.preventDefault();
    const res = await fetch("/api/staff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, displayName, role }),
    });
    const json = await res.json();
    setMessage(json.ok ? `Added ${displayName}` : json.error);
    if (json.ok) {
      setEmail("");
      setDisplayName("");
      await refresh();
    }
  }

  async function changeRole(row: StaffRow, nextRole: StaffRole) {
    const res = await fetch("/api/staff", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intent: "role",
        staffUserId: row.id,
        role: nextRole,
        expectedVersion: row.version,
      }),
    });
    const json = await res.json();
    setMessage(json.ok ? `Role updated` : json.error);
    await refresh();
  }

  async function setOverride(row: StaffRow, permission: Permission, effect: PermissionEffect | null) {
    const res = await fetch("/api/staff", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intent: "override",
        staffUserId: row.id,
        permission,
        effect,
      }),
    });
    const json = await res.json();
    setMessage(json.ok ? `Override saved` : json.error);
    await refresh();
  }

  async function revoke(row: StaffRow) {
    const res = await fetch("/api/staff", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "revoke", staffUserId: row.id }),
    });
    const json = await res.json();
    setMessage(json.ok ? `Revoked` : json.error);
    await refresh();
  }

  async function impersonate(row: StaffRow) {
    const res = await fetch("/api/impersonate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetStaffUserId: row.id }),
    });
    const json = await res.json();
    setMessage(json.ok ? `Impersonation started` : json.error);
    if (json.ok) window.location.href = "/admin";
  }

  const labels = permissionLabels();

  return (
    <div className="space-y-8">
      <form onSubmit={addStaff} className="grid gap-3 rounded-[var(--radius-lg)] bg-white p-4 shadow-sm md:grid-cols-4">
        <Input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <select
          className="rounded-[var(--radius-md)] border border-[var(--color-forest)]/25 px-3 py-2 text-sm"
          value={role}
          onChange={(e) => setRole(e.target.value as StaffRole)}
        >
          {Object.values(StaffRole).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <Button type="submit">Add staff</Button>
      </form>

      {message ? <p className="text-sm text-[var(--color-forest)]">{message}</p> : null}

      <div className="space-y-4">
        {staff.map((row) => (
          <article key={row.id} className="rounded-[var(--radius-lg)] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold">{row.displayName}</h3>
                <p className="text-sm opacity-70">
                  {row.email} · {row.role} · v{row.version}
                  {!row.isActive || row.revokedAt ? " · revoked" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  className="rounded-[var(--radius-md)] border px-2 py-1 text-sm"
                  value={row.role}
                  onChange={(e) => changeRole(row, e.target.value as StaffRole)}
                >
                  {Object.values(StaffRole).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="secondary" onClick={() => impersonate(row)}>
                  Impersonate
                </Button>
                <Button type="button" variant="danger" onClick={() => revoke(row)}>
                  Revoke
                </Button>
              </div>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {PERMISSIONS.map((permission) => {
                const current = row.permissionOverrides.find((o) => o.permission === permission)?.effect ?? "";
                return (
                  <label key={permission} className="flex items-center justify-between gap-2 text-sm">
                    <span>{labels[permission]}</span>
                    <select
                      className="rounded border px-2 py-1"
                      value={current}
                      onChange={(e) =>
                        setOverride(
                          row,
                          permission,
                          e.target.value === "" ? null : (e.target.value as PermissionEffect),
                        )
                      }
                    >
                      <option value="">default</option>
                      <option value={PermissionEffect.GRANT}>grant</option>
                      <option value={PermissionEffect.DENY}>deny</option>
                    </select>
                  </label>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
