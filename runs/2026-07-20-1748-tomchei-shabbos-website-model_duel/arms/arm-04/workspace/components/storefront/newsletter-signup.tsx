"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NewsletterSignup() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function subscribe(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? "Subscription failed. Try again.");
        return;
      }
      setMessage("You're on the list! We'll email you when the store opens.");
      setEmail("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={subscribe} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          aria-label="Email address"
          className="flex-1"
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Joining…" : "Join"}
        </Button>
      </div>
      {message && <p className="text-xs text-muted">{message}</p>}
    </form>
  );
}
