// ponytail: no clsx/tailwind-merge dependency for simple class joining.
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
