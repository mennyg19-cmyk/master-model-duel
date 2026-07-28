"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ProfileForm({
  initialName,
  initialEmail,
  initialPhone,
}: {
  initialName: string;
  initialEmail: string;
  initialPhone: string;
}) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await apiFetch("/api/account/profile", {
      method: "PATCH",
      body: { name, email, phone: phone || null },
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.body.error ?? "Could not save the profile" });
      return;
    }
    setMessage({ tone: "ok", text: "Profile saved." });
  }

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
      <label className="text-sm text-stone-700">
        Name
        <Input value={name} onChange={(event) => setName(event.target.value)} className="mt-1" required />
      </label>
      <label className="text-sm text-stone-700">
        Email
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1"
          required
        />
      </label>
      <label className="text-sm text-stone-700">
        Phone (optional)
        <Input value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1" />
      </label>
      {message && (
        <p className={message.tone === "ok" ? "text-sm text-green-700" : "text-sm text-red-600"} role="status">
          {message.text}
        </p>
      )}
      <div>
        <Button type="submit" disabled={busy} data-profile-save>
          {busy ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}
