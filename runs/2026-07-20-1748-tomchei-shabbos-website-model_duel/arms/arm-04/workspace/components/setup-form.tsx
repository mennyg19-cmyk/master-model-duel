"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SetupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitSetup(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    const response = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    setIsSubmitting(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setErrorMessage(body?.error ?? "Setup failed");
      return;
    }
    router.push("/admin");
  }

  return (
    <form onSubmit={submitSetup} className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        No staff accounts exist yet. Create the first manager account to unlock the admin area.
      </p>
      <Input placeholder="Full name" value={name} onChange={(changeEvent) => setName(changeEvent.target.value)} required />
      <Input type="email" placeholder="Email" value={email} onChange={(changeEvent) => setEmail(changeEvent.target.value)} required />
      <Input
        type="password"
        placeholder="Password (8+ characters)"
        value={password}
        onChange={(changeEvent) => setPassword(changeEvent.target.value)}
        minLength={8}
        required
      />
      {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Creating..." : "Create manager account"}
      </Button>
    </form>
  );
}
