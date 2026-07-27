"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ProfileForm({ initialName, initialPhone }: { initialName: string; initialPhone: string | null }) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    const response = await fetch("/api/account/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone: phone.trim() || null }),
    });
    setIsSubmitting(false);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage({ kind: "error", text: body?.error ?? "Could not save your profile" });
      return;
    }
    setMessage({ kind: "ok", text: "Profile saved" });
  }

  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
      <label className="text-sm font-medium">
        Name
        <Input className="mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label className="text-sm font-medium">
        Phone (optional)
        <Input className="mt-1 w-full" value={phone} onChange={(event) => setPhone(event.target.value)} />
      </label>
      {message && (
        <p className={`text-sm ${message.kind === "ok" ? "text-success" : "text-danger"}`}>{message.text}</p>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
