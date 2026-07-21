import { type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-[var(--radius-md)] border border-[var(--color-forest)]/25 bg-white px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-leaf)]",
        className,
      )}
      {...props}
    />
  );
}
