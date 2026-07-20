"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="grid min-h-screen place-items-center bg-[#f7f3f7] px-6">
          <div className="max-w-lg rounded-3xl bg-white p-10 text-center shadow-xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#8f2f67]">
              Something went wrong
            </p>
            <h1 className="mt-4 text-3xl font-bold text-[#241f2d]">
              This page could not be loaded
            </h1>
            <p className="mt-3 text-[#6f6878]">
              Try the request once more. The error details were hidden to
              protect private information.
            </p>
            <button
              className="mt-7 rounded-xl bg-[#8f2f67] px-5 py-3 font-bold text-white"
              onClick={reset}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
