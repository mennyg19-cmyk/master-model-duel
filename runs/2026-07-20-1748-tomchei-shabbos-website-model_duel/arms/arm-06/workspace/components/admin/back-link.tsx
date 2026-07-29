import Link from "next/link";

// R-106 admin chrome: the detail-page back link — one shape everywhere so a
// staff user never hunts for the way out of a detail screen.
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-sm font-medium text-brand-700 hover:underline">
      ← {label}
    </Link>
  );
}
