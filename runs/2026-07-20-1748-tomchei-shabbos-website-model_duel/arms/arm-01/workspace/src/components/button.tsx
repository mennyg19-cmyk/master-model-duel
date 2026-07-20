import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "secondary";
};

export function Button({
  className = "",
  tone = "primary",
  ...buttonProps
}: ButtonProps) {
  const toneClass =
    tone === "primary"
      ? "bg-[var(--brand)] text-white hover:bg-[var(--brand-dark)]"
      : "border border-[var(--border)] bg-white text-[var(--ink)] hover:bg-[var(--surface)]";
  return (
    <button
      className={`min-h-11 rounded-xl px-4 py-2 font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50 ${toneClass} ${className}`}
      {...buttonProps}
    />
  );
}
