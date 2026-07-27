"use client";

import { useEffect, useState } from "react";

type StaffUser = {
  id: string;
  displayName: string;
  email: string;
  role: "MANAGER" | "STAFF" | "DRIVER";
  revokedAt?: string;
  version: number;
  overrides: Record<string, "GRANT" | "DENY">;
};

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [message, setMessage] = useState("");

  async function loadStaff() {
    const response = await fetch("/api/staff");
    setStaff((await response.json()).staff);
  }

  useEffect(() => {
    const abortController = new AbortController();
    void fetch("/api/staff", { signal: abortController.signal })
      .then(async (response) => response.json())
      .then((body) => setStaff(body.staff));
    return () => abortController.abort();
  }, []);

  async function invite(formData: FormData) {
    const response = await fetch("/api/staff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(formData)),
    });
    const body = await response.json();
    setMessage(response.ok ? `Invite linked for ${body.staffMember.email}` : body.error);
    if (response.ok) await loadStaff();
  }

  async function act(staffId: string, action: "revoke" | "impersonate") {
    const response = await fetch(`/api/staff/${staffId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = await response.json();
    setMessage(response.ok ? body.message : body.error);
    await loadStaff();
  }

  return (
    <>
      <p className="eyebrow">Staff & permissions</p>
      <h1>Access has an owner.</h1>
      <section className="card">
        <h2>Invite staff</h2>
        <form action={invite}>
          <label htmlFor="displayName">Name</label>
          <input id="displayName" name="displayName" required />
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required />
          <label htmlFor="clerkUserId">Clerk user ID</label>
          <input id="clerkUserId" name="clerkUserId" required />
          <label htmlFor="role">Role</label>
          <select id="role" name="role" defaultValue="STAFF">
            <option value="MANAGER">Manager</option>
            <option value="STAFF">Staff</option>
            <option value="DRIVER">Driver</option>
          </select>
          <button className="button" type="submit">Link invitation</button>
        </form>
        {message && <p role="status">{message}</p>}
      </section>
      <div className="grid">
        {staff.map((staffMember) => (
          <section className="card" key={staffMember.id}>
            <h2>{staffMember.displayName}</h2>
            <p>{staffMember.email} · {staffMember.role}</p>
            <p>{staffMember.revokedAt ? "Revoked" : `Version ${staffMember.version}`}</p>
            {!staffMember.revokedAt && (
              <>
                <button className="button secondary" onClick={() => void act(staffMember.id, "impersonate")}>Impersonate</button>{" "}
                <button className="button" onClick={() => void act(staffMember.id, "revoke")}>Revoke</button>
              </>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
