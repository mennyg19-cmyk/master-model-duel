import { cn } from "@/lib/cn";

// The category/filter pill shared by the storefront grid and the order
// builder's product panel — one chip, one active/inactive split.
export function FilterChip({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm font-medium",
        isActive
          ? "border-brand-700 bg-brand-700 text-white"
          : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100",
      )}
    >
      {label}
    </button>
  );
}
