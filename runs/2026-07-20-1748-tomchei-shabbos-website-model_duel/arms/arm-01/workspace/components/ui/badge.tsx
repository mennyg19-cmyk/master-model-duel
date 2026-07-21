import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

type BadgeTone = "brand" | "neutral" | "danger" | "success";

const TONE_CLASSES: Record<BadgeTone, string> = {
  brand: "bg-brand-soft text-brand-strong",
  neutral: "bg-border text-muted",
  danger: "bg-red-100 text-danger",
  success: "bg-green-100 text-success",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className
      )}
      {...props}
    />
  );
}
