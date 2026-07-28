"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { apiFetch } from "@/lib/api-fetch";

export function NewStaffForm() {
  const [error, setError] = useState<string | null>(null);
  const [invitePath, setInvitePath] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setInvitePath(null);

    const form = new FormData(event.currentTarget);
    const { ok, body } = await apiFetch<{ invitePath?: string }>("/api/admin/staff", {
      method: "POST",
      body: {
        name: String(form.get("name")),
        email: String(form.get("email")),
        role: String(form.get("role")),
      },
    });
    setIsSubmitting(false);

    if (!ok) {
      setError(body.error ?? "Could not create the staff account");
      return;
    }
    setInvitePath(body.invitePath ?? null);
    (event.target as HTMLFormElement).reset();
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div>
        <Label htmlFor="role">Role</Label>
        <Select id="role" name="role" defaultValue="STAFF">
          <option value="STAFF">Staff</option>
          <option value="MANAGER">Manager</option>
          <option value="DRIVER">Driver</option>
        </Select>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {invitePath && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Invite link:{" "}
          <a href={invitePath} className="font-medium underline">
            {invitePath}
          </a>{" "}
          (dev: open it to confirm the account)
        </p>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Creating…" : "Create account"}
      </Button>
    </form>
  );
}
