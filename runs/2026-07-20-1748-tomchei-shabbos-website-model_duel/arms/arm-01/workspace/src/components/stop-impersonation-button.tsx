"use client";

import { useState } from "react";

export function StopImpersonationButton() {
  const [isStopping, setIsStopping] = useState(false);

  async function stopImpersonating() {
    setIsStopping(true);
    const response = await fetch("/api/admin/impersonation", {
      method: "DELETE",
    });
    if (response.ok) {
      window.location.assign("/admin");
      return;
    }
    setIsStopping(false);
  }

  return (
    <button
      className="ml-3 rounded-lg border border-[var(--ink)] px-3 py-1 disabled:opacity-60"
      disabled={isStopping}
      onClick={stopImpersonating}
      type="button"
    >
      {isStopping ? "Stopping…" : "Stop impersonating"}
    </button>
  );
}
