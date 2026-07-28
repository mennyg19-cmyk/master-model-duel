"use client";

import { useEffect } from "react";
import { BRAND } from "@/lib/brand";

// global-error replaces the root layout, so globals.css may not be loaded —
// inline brand styles instead of Tailwind classes here.
export default function RootError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    fetch("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        url: window.location.href,
        stackFirstLine: error.stack?.split("\n")[0],
      }),
    }).catch(() => {
      // Reporting must never mask the original error.
    });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fafaf9" }}>
        <main style={{ padding: "4rem", textAlign: "center" }}>
          <p style={{ color: "#5b21b6", fontWeight: 600 }}>{BRAND.orgName}</p>
          <h1 style={{ color: "#1c1917" }}>Something went wrong</h1>
          <p style={{ color: "#57534e" }}>
            The application hit an unexpected error. It was reported automatically.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              borderRadius: 6,
              border: "none",
              background: "#5b21b6",
              color: "#fff",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
