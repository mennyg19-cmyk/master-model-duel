import { cn } from "@/lib/cn";
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";

const FIELD_CLASSES =
  "rounded-md border border-border bg-surface px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD_CLASSES, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(FIELD_CLASSES, className)} {...props} />;
}
