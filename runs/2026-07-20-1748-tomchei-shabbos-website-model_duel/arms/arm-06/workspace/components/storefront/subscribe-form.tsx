"use client";

import { FormEvent, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// R-009/R-013: footer + homepage share this subscribe form. Manage/preference
// links arrive by email (P11) — the API never returns tokens to the caller.
export function SubscribeForm({ source }: { source: "footer" | "homepage" }) {
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const { ok, body } = await apiFetch("/api/subscribe", {
      method: "POST",
      body: {
        email: String(form.get("email") ?? ""),
        name: String(form.get("name") ?? ""),
        source,
      },
    });

    if (!ok) {
      setStatus("error");
      setMessage(body.error ?? "Could not subscribe right now");
      return;
    }
    setStatus("done");
    (event.target as HTMLFormElement).reset();
  }

  if (status === "done") {
    return (
      <p className="text-sm text-green-700">
        You&apos;re on the list — watch for a confirmation email with your preferences link.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          id={`subscribe-email-${source}`}
          name="email"
          type="email"
          required
          placeholder="you@example.org"
          aria-label="Email address"
          className="max-w-xs"
        />
        <Button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Joining…" : "Subscribe"}
        </Button>
      </div>
      {source === "homepage" && (
        <Input id="subscribe-name-homepage" name="name" placeholder="Name (optional)" aria-label="Name" className="max-w-xs" />
      )}
      {status === "error" && <p className="text-sm text-red-600">{message}</p>}
    </form>
  );
}
