"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", padding: "4rem", textAlign: "center" }}>
        <h1>Something went wrong</h1>
        <p>The page failed to load. Please try again.</p>
        <button onClick={reset} style={{ padding: "0.5rem 1rem", cursor: "pointer" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
