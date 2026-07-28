import { HTMLAttributes } from "react";
import { StaffRole } from "@prisma/client";
import { cn } from "@/lib/cn";

type Tone = "brand" | "green" | "amber" | "red" | "stone";

export const ROLE_TONES: Record<StaffRole, Tone> = {
  MANAGER: "brand",
  STAFF: "green",
  DRIVER: "amber",
};

const tones: Record<Tone, string> = {
  brand: "bg-brand-100 text-brand-900",
  green: "bg-green-100 text-green-800",
  amber: "bg-accent-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  stone: "bg-stone-100 text-stone-700",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ className, tone = "stone", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
