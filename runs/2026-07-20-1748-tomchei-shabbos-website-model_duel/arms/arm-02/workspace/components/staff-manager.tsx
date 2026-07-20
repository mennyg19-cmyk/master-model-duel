"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PERMISSIONS, ALL_PERMISSIONS, type Permission } from "@/lib/auth/permissions";

type StaffMember = {
  id: string;
  name: string;
  email: string;
  role: "MANAGER" | "STAFF" | "DRIVER";
  status: "ACTIVE" | "REVOKED";
  overrides: { permission: string; effect: "GRANT" | "DENY" }[];
};

type OverrideState = "inherit" | "GRANT" | "DENY";

export function StaffManager({
  staffMembers,
  currentUserId,
  canImpersonate,
}: {
  staffMembers: StaffMember[];
  currentUserId: string;
  canImpersonate: boolean;
}) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function callApi(path: string, method: string, body?: unknown) {
    setErrorMessage(null);
    const response = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      setErrorMessage(responseBody?.error ?? `Request failed (${response.status})`);
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="flex flex-col gap-6">
      {errorMessage && (
        <p className="rounded-md bg-red-100 px-3 py-2 text-sm text-danger">{errorMessage}</p>
      )}
      <AddStaffForm onSubmit={(fields) => callApi("/api/staff", "POST", fields)} />
      <div className="grid gap-4">
        {staffMembers.map((member) => (
          <StaffRow
            key={member.id}
            member={member}
            isSelf={member.id === currentUserId}
            canImpersonate={canImpersonate}
            callApi={callApi}
          />
        ))}
      </div>
    </div>
  );
}

function AddStaffForm({
  onSubmit,
}: {
  onSubmit: (fields: { name: string; email: string; role: string; password: string }) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("STAFF");
  const [password, setPassword] = useState("");

  return (
    <Card>
      <CardTitle>Add staff member</CardTitle>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (formEvent) => {
          formEvent.preventDefault();
          const created = await onSubmit({ name, email, role, password });
          if (created) {
            setName("");
            setEmail("");
            setPassword("");
          }
        }}
      >
        <Input placeholder="Name" value={name} onChange={(changeEvent) => setName(changeEvent.target.value)} required />
        <Input type="email" placeholder="Email" value={email} onChange={(changeEvent) => setEmail(changeEvent.target.value)} required />
        <Select value={role} onChange={(changeEvent) => setRole(changeEvent.target.value)}>
          <option value="MANAGER">Manager</option>
          <option value="STAFF">Staff</option>
          <option value="DRIVER">Driver</option>
        </Select>
        <Input
          type="password"
          placeholder="Password (8+)"
          value={password}
          onChange={(changeEvent) => setPassword(changeEvent.target.value)}
          minLength={8}
          required
        />
        <Button type="submit">Add</Button>
      </form>
    </Card>
  );
}

function StaffRow({
  member,
  isSelf,
  canImpersonate,
  callApi,
}: {
  member: StaffMember;
  isSelf: boolean;
  canImpersonate: boolean;
  callApi: (path: string, method: string, body?: unknown) => Promise<boolean>;
}) {
  const [isEditingOverrides, setIsEditingOverrides] = useState(false);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-40">
          <p className="font-medium">
            {member.name} {isSelf && <span className="text-xs text-muted">(you)</span>}
          </p>
          <p className="text-xs text-muted">{member.email}</p>
        </div>
        <Badge tone="brand">{member.role}</Badge>
        <Badge tone={member.status === "ACTIVE" ? "success" : "danger"}>{member.status}</Badge>
        {!isSelf && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Select
              value={member.role}
              onChange={(changeEvent) =>
                callApi(`/api/staff/${member.id}`, "PATCH", { role: changeEvent.target.value })
              }
            >
              <option value="MANAGER">Manager</option>
              <option value="STAFF">Staff</option>
              <option value="DRIVER">Driver</option>
            </Select>
            <Button variant="secondary" onClick={() => setIsEditingOverrides(!isEditingOverrides)}>
              Permissions
            </Button>
            {canImpersonate && member.status === "ACTIVE" && (
              <Button
                variant="secondary"
                onClick={() => callApi("/api/impersonate", "POST", { staffUserId: member.id })}
              >
                Impersonate
              </Button>
            )}
            <Button
              variant={member.status === "ACTIVE" ? "danger" : "primary"}
              onClick={() =>
                callApi(`/api/staff/${member.id}`, "PATCH", {
                  status: member.status === "ACTIVE" ? "REVOKED" : "ACTIVE",
                })
              }
            >
              {member.status === "ACTIVE" ? "Revoke" : "Reactivate"}
            </Button>
          </div>
        )}
      </div>
      {isEditingOverrides && !isSelf && (
        <OverrideEditor
          overrides={member.overrides}
          onSave={(overrides) => callApi(`/api/staff/${member.id}/overrides`, "PUT", { overrides })}
        />
      )}
    </Card>
  );
}

function OverrideEditor({
  overrides,
  onSave,
}: {
  overrides: { permission: string; effect: "GRANT" | "DENY" }[];
  onSave: (overrides: { permission: string; effect: "GRANT" | "DENY" }[]) => Promise<boolean>;
}) {
  const initialStates = Object.fromEntries(
    ALL_PERMISSIONS.map((permission) => [
      permission,
      (overrides.find((override) => override.permission === permission)?.effect ??
        "inherit") as OverrideState,
    ])
  ) as Record<Permission, OverrideState>;
  const [states, setStates] = useState(initialStates);

  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="text-sm font-medium mb-2">Permission overrides (inherit = role default)</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {ALL_PERMISSIONS.map((permission) => (
          <label key={permission} className="flex items-center gap-2 text-sm">
            <Select
              value={states[permission]}
              onChange={(changeEvent) =>
                setStates({ ...states, [permission]: changeEvent.target.value as OverrideState })
              }
            >
              <option value="inherit">Inherit</option>
              <option value="GRANT">Grant</option>
              <option value="DENY">Deny</option>
            </Select>
            <span title={PERMISSIONS[permission]}>{permission}</span>
          </label>
        ))}
      </div>
      <Button
        className="mt-3"
        onClick={() =>
          onSave(
            ALL_PERMISSIONS.filter((permission) => states[permission] !== "inherit").map(
              (permission) => ({
                permission,
                effect: states[permission] as "GRANT" | "DENY",
              })
            )
          )
        }
      >
        Save overrides
      </Button>
    </div>
  );
}
