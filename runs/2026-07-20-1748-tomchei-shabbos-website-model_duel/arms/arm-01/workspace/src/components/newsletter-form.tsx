"use client";

import { useState } from "react";

export function NewsletterForm({ compact = false }: { compact?: boolean }) {
  const [message, setMessage] = useState("");

  async function subscribe(formData: FormData) {
    const response = await fetch("/api/newsletter/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: formData.get("email") }),
    });
    const payload = (await response.json()) as { error?: string; message?: string };
    setMessage(payload.error ?? payload.message ?? "");
  }

  return (
    <form action={subscribe} className={compact ? "max-w-md" : "mx-auto max-w-xl"}>
      {!compact && (
        <>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand-light)]">
            Notes from the neighborhood
          </p>
          <h2 className="mt-3 text-3xl font-bold text-white">
            See what your Purim gift makes possible.
          </h2>
        </>
      )}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor={compact ? "footer-email" : "newsletter-email"}>
          Email address
        </label>
        <input
          className="min-w-0 flex-1 rounded-full border border-white/20 bg-white px-5 py-3 text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--brand-light)]"
          id={compact ? "footer-email" : "newsletter-email"}
          name="email"
          placeholder="you@example.com"
          required
          type="email"
        />
        <button
          className="rounded-full bg-[var(--brand-light)] px-6 py-3 font-bold text-[var(--ink)]"
          type="submit"
        >
          Join the list
        </button>
      </div>
      {message && (
        <p aria-live="polite" className="mt-3 text-sm text-white/80">
          {message}
        </p>
      )}
    </form>
  );
}
