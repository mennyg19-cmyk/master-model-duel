"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/button";

export default function SetupPage() {
  const [isLocked, setIsLocked] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/setup")
      .then((response) => response.json())
      .then((payload) => setIsLocked(payload.locked));
  }, []);

  async function bootstrapManager(formData: FormData) {
    const response = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: formData.get("displayName"),
        email: formData.get("email"),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error);
      setIsLocked(response.status === 409);
      return;
    }
    setMessage("First manager created. Setup is now locked.");
    setIsLocked(true);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--surface)] px-6 py-16">
      <div className="w-full max-w-lg rounded-[2rem] border border-[var(--border)] bg-white p-8 shadow-xl">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
          First-run setup
        </p>
        <h1 className="mt-3 text-4xl font-bold">Create the first manager</h1>
        {isLocked ? (
          <div className="mt-7 rounded-2xl bg-[var(--brand-soft)] p-5">
            <p className="font-bold">Setup locked</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              A manager already exists. Future staff must be invited from the
              staff portal.
            </p>
          </div>
        ) : (
          <form action={bootstrapManager} className="mt-7 grid gap-4">
            <label className="grid gap-2 text-sm font-semibold">
              Full name
              <input className="rounded-xl border border-[var(--border)] px-4 py-3" name="displayName" required />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Email
              <input className="rounded-xl border border-[var(--border)] px-4 py-3" name="email" type="email" required />
            </label>
            <Button type="submit">Create manager and lock setup</Button>
          </form>
        )}
        {message && <p aria-live="polite" className="mt-5 text-sm font-semibold">{message}</p>}
      </div>
    </main>
  );
}
