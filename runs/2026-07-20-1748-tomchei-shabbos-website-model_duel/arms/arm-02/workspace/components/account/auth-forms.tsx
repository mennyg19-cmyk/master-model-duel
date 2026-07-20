"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";

/** Customer sign-in / create-account card (dev auth mode). */
export function CustomerAuthForms() {
  const router = useRouter();
  const [tab, setTab] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    const endpoint = tab === "signin" ? "/api/account/login" : "/api/account/register";
    const payload = tab === "signin" ? { email, password } : { email, name, password };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
    <Card className="w-full max-w-sm">
      <CardTitle>{tab === "signin" ? "Sign in" : "Create your account"}</CardTitle>
      <div role="tablist" className="mb-4 flex gap-1 rounded-md bg-brand-soft p-1">
        {(
          [
            { id: "signin", label: "Sign in" },
            { id: "register", label: "Create account" },
          ] as const
        ).map((candidate) => (
          <button
            key={candidate.id}
            role="tab"
            aria-selected={tab === candidate.id}
            onClick={() => {
              setTab(candidate.id);
              setErrorMessage(null);
            }}
            className={cn(
              "flex-1 rounded px-2 py-1.5 text-xs font-medium",
              tab === candidate.id ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"
            )}
          >
            {candidate.label}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {tab === "register" && (
          <Input
            placeholder="Full name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        )}
        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <Input
          type="password"
          placeholder={tab === "register" ? "Password (8+ characters)" : "Password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Working…" : tab === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>
    </Card>
  );
}
