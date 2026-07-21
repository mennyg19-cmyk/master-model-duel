"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", padding: 24 }}>
        <h1>Application error</h1>
        <p>{error.message}</p>
        <button type="button" onClick={reset}>
          Retry
        </button>
      </body>
    </html>
  );
}
