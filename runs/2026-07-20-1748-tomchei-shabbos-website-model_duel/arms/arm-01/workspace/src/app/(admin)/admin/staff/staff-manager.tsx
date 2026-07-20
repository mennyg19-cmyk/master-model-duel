"use client";

import { useState } from "react";
import type { StaffRole, StaffStatus } from "@prisma/client";
import { Button } from "@/components/button";
import { permissions } from "@/lib/permissions";

type StaffUser = {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  status: StaffStatus;
  grantPermissions: string[];
  denyPermissions: string[];
  version: number;
};

export function StaffManager({
  initialStaffUsers,
}: {
  initialStaffUsers: StaffUser[];
}) {
  const [staffUsers, setStaffUsers] = useState(initialStaffUsers);
  const [message, setMessage] = useState("");
  const [inviteToken, setInviteToken] = useState("");

  async function inviteStaff(formData: FormData) {
    const response = await fetch("/api/admin/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: formData.get("displayName"),
        email: formData.get("email"),
        role: formData.get("role"),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error);
      return;
    }
    setStaffUsers((current) => [...current, payload.staffUser]);
    setInviteToken(payload.inviteToken);
    setMessage(
      `Invitation created for ${payload.staffUser.email}. Copy the one-time token below now; it cannot be retrieved later.`,
    );
  }

  async function updateStaff(
    staffUser: StaffUser,
    changes: Partial<StaffUser>,
  ) {
    const response = await fetch("/api/admin/staff", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: staffUser.id,
        version: staffUser.version,
        ...changes,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error);
      return;
    }
    setStaffUsers((current) =>
      current.map((candidate) =>
        candidate.id === staffUser.id ? payload.staffUser : candidate,
      ),
    );
    setMessage(`Saved access for ${payload.staffUser.displayName}.`);
  }

  async function impersonate(staffUser: StaffUser) {
    const response = await fetch("/api/admin/impersonation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetStaffId: staffUser.id }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error);
      return;
    }
    window.location.assign("/admin");
  }

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
        Identity & authorization
      </p>
      <h1 className="mt-2 text-4xl font-bold">Staff & access</h1>
      <form
        action={inviteStaff}
        className="mt-8 grid gap-4 rounded-3xl border border-[var(--border)] bg-white p-6 md:grid-cols-[1fr_1fr_160px_auto]"
      >
        <label className="grid gap-2 text-sm font-semibold">
          Name
          <input className="rounded-xl border border-[var(--border)] px-3 py-2.5" name="displayName" required />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Email
          <input className="rounded-xl border border-[var(--border)] px-3 py-2.5" name="email" type="email" required />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Role
          <select className="rounded-xl border border-[var(--border)] px-3 py-2.5" name="role">
            <option value="STAFF">Staff</option>
            <option value="DRIVER">Driver</option>
            <option value="MANAGER">Manager</option>
          </select>
        </label>
        <Button className="self-end" type="submit">Invite</Button>
      </form>
      {message && (
        <p aria-live="polite" className="mt-4 rounded-xl bg-[var(--brand-soft)] px-4 py-3 text-sm font-semibold">
          {message}
        </p>
      )}
      {inviteToken && (
        <div className="mt-3 rounded-xl border border-[var(--warning)] bg-white px-4 py-3">
          <p className="text-sm font-semibold">One-time invitation token</p>
          <code className="mt-1 block break-all select-all text-sm">{inviteToken}</code>
          <Button className="mt-3" onClick={() => setInviteToken("")} tone="secondary">
            I copied it
          </Button>
        </div>
      )}
      <div className="mt-6 space-y-4">
        {staffUsers.map((staffUser) => (
          <article key={staffUser.id} className="rounded-3xl border border-[var(--border)] bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold">{staffUser.displayName}</h2>
                <p className="text-sm text-[var(--muted)]">{staffUser.email} · {staffUser.status}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  aria-label={`Role for ${staffUser.displayName}`}
                  className="rounded-xl border border-[var(--border)] px-3 py-2"
                  onChange={(event) => updateStaff(staffUser, { role: event.target.value as StaffRole })}
                  value={staffUser.role}
                >
                  <option value="MANAGER">Manager</option>
                  <option value="STAFF">Staff</option>
                  <option value="DRIVER">Driver</option>
                </select>
                <Button onClick={() => impersonate(staffUser)} tone="secondary">Impersonate</Button>
                {staffUser.status !== "REVOKED" && (
                  <Button onClick={() => updateStaff(staffUser, { status: "REVOKED" })} tone="secondary">
                    Revoke
                  </Button>
                )}
              </div>
            </div>
            <fieldset className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <legend className="mb-3 font-semibold">Personal grants</legend>
              {permissions.map((permission) => (
                <label key={permission} className="flex items-center gap-2 text-sm">
                  <input
                    checked={staffUser.grantPermissions.includes(permission)}
                    onChange={(event) =>
                      updateStaff(staffUser, {
                        grantPermissions: event.target.checked
                          ? [...staffUser.grantPermissions, permission]
                          : staffUser.grantPermissions.filter((grant) => grant !== permission),
                      })
                    }
                    type="checkbox"
                  />
                  {permission}
                </label>
              ))}
            </fieldset>
            <fieldset className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <legend className="mb-3 font-semibold">Personal denies</legend>
              {permissions.map((permission) => (
                <label key={permission} className="flex items-center gap-2 text-sm">
                  <input
                    checked={staffUser.denyPermissions.includes(permission)}
                    onChange={(event) =>
                      updateStaff(staffUser, {
                        denyPermissions: event.target.checked
                          ? [...staffUser.denyPermissions, permission]
                          : staffUser.denyPermissions.filter((deny) => deny !== permission),
                      })
                    }
                    type="checkbox"
                  />
                  {permission}
                </label>
              ))}
            </fieldset>
          </article>
        ))}
      </div>
    </div>
  );
}
