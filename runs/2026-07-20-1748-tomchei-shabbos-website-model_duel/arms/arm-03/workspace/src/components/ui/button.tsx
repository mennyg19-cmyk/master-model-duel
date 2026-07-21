import { type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-[var(--color-leaf)] text-white hover:bg-[var(--color-forest)]",
  secondary: "bg-white text-[var(--color-ink)] border border-[var(--color-forest)]/20 hover:bg-[var(--color-cream)]",
  danger: "bg-[var(--color-danger)] text-white hover:opacity-90",
  ghost: "bg-transparent text-[var(--color-ink)] hover:bg-black/5",
};

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-[var(--radius-md)] px-3 py-2 text-sm font-semibold transition disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
