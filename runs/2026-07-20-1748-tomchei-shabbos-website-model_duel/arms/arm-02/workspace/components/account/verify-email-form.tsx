"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Set-password form for the email-confirmation registration step (SR-01). */
export function VerifyEmailForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    const response = await fetch("/api/account/register/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setIsSubmitting(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setErrorMessage(body?.error ?? "Something went wrong");
      return;
    }
    router.push("/account");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input
        type="password"
        placeholder="Password (8+ characters)"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Working…" : "Create account"}
      </Button>
    </form>
  );
}
