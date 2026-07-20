"use client";

export function BackLink({ fallback }: { fallback: string }) {
  return (
    <button
      className="text-sm font-bold text-[var(--brand)]"
      onClick={() => {
        if (window.history.length > 1) window.history.back();
        else window.location.assign(fallback);
      }}
      type="button"
    >
      ← Back
    </button>
  );
}
