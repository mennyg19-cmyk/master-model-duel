"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SetupForm() {
  const [email, setEmail] = useState("manager@tomchei.local");
  const [displayName, setDisplayName] = useState("First Manager");
  const [status, setStatus] = useState("");

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, displayName }),
    });
    const json = await res.json();
    setStatus(json.ok ? "Manager created. Setup is now locked." : json.error);
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-16 max-w-md space-y-4 rounded-[var(--radius-lg)] bg-white p-6 shadow-sm">
      <h1 className="font-[family-name:var(--font-display)] text-2xl text-[var(--color-forest)]">
        First-run setup
      </h1>
      <p className="text-sm opacity-80">
        Empty database: create the first manager, then this page locks.
      </p>
      <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" required />
      <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" required />
      <Button type="submit" className="w-full">
        Bootstrap manager
      </Button>
      {status ? <p className="text-sm">{status}</p> : null}
    </form>
  );
}
