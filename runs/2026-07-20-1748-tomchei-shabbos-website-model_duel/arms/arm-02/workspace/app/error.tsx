"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Redacted report: message + path only, no stack or user data (R-132).
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.digest ?? error.message.slice(0, 500),
        path: window.location.pathname,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <Card className="w-full max-w-md text-center">
        <CardTitle>Something went wrong</CardTitle>
        <p className="text-sm text-muted mb-4">
          The error was reported. Try again, or come back in a moment.
        </p>
        <Button onClick={reset}>Try again</Button>
      </Card>
    </main>
  );
}
