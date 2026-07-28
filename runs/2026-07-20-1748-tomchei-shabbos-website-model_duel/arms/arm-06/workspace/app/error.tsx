"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-stone-900">Something went wrong</h1>
        <p className="mt-2 text-stone-600">
          The error was reported automatically. You can retry the page.
        </p>
        {error.digest && <p className="mt-2 text-xs text-stone-400">Reference: {error.digest}</p>}
        <Button className="mt-6" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
