"use client";

import { useState } from "react";

export function ProfileEditor({
  customer,
}: {
  customer: {
    displayName: string;
    email: string | null;
    phone: string | null;
  };
}) {
  const [message, setMessage] = useState("");

  async function saveProfile(formData: FormData) {
    const response = await fetch("/api/account/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: formData.get("displayName"),
        email: formData.get("email"),
        phone: formData.get("phone"),
      }),
    });
    const payload = await response.json();
    setMessage(response.ok ? "Profile saved." : payload.error ?? "Profile could not be saved.");
  }

  return (
    <form action={saveProfile} className="rounded-[2rem] border border-[var(--border)] bg-white p-7">
      <h1 className="text-3xl font-black">Profile</h1>
      <p className="mt-2 text-[var(--muted)]">Only your signed-in identity can update this profile.</p>
      <div className="mt-6 grid gap-4">
        <ProfileField defaultValue={customer.displayName} label="Name" name="displayName" required />
        <ProfileField defaultValue={customer.email ?? ""} label="Email" name="email" type="email" />
        <ProfileField defaultValue={customer.phone ?? ""} label="Phone" name="phone" type="tel" />
      </div>
      <button className="mt-6 rounded-full bg-[var(--brand)] px-6 py-3 font-bold text-white" type="submit">
        Save profile
      </button>
      {message && <p className="mt-3 text-sm font-bold">{message}</p>}
    </form>
  );
}

function ProfileField({
  label,
  ...inputProps
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="text-sm font-bold">
      {label}
      <input {...inputProps} className="mt-1 w-full rounded-xl border border-[var(--border)] px-4 py-3" />
    </label>
  );
}
