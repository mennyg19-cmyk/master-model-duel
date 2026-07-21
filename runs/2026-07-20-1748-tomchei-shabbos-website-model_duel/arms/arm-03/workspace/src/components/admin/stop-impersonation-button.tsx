"use client";

import { useState } from "react";

export function StopImpersonationButton() {
  const [pending, setPending] = useState(false);

  async function onStop() {
    if (pending) return;
    setPending(true);
    try {
      await fetch("/api/impersonate", { method: "DELETE" });
      window.location.href = "/admin";
    } catch {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onStop}
      disabled={pending}
      className="underline disabled:opacity-60"
    >
      {pending ? "Stopping…" : "Stop"}
    </button>
  );
}
