"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Runs a mutation, surfaces the outcome message, and refreshes on success. */
export type ActFn = (action: () => Promise<{ ok: boolean; error?: string }>, successMessage?: string) => Promise<void>;

/** Shared admin-hub mutation plumbing (email hub, settings hub). */
export function useHubAct(): { message: string | null; act: ActFn } {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  const act: ActFn = async (action, successMessage = "Saved.") => {
    setMessage(null);
    const outcome = await action();
    setMessage(outcome.ok ? successMessage : outcome.error ?? "Request failed.");
    if (outcome.ok) router.refresh();
  };

  return { message, act };
}
