import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { NewsletterSignup } from "@/components/storefront/newsletter-signup";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-surface">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3 sm:px-6">
        <div>
          <p className="font-semibold text-brand-strong">{BRAND.shortName}</p>
          <p className="mt-2 text-sm text-muted">{BRAND.tagline}</p>
          <p className="mt-2 text-sm text-muted">
            Every order helps feed local families for Shabbos, all year round.
          </p>
        </div>
        <div className="text-sm">
          <p className="font-medium mb-2">Explore</p>
          <ul className="space-y-1 text-muted">
            <li><Link href="/catalog" className="hover:text-brand">Shop the catalog</Link></li>
            <li><Link href="/collections" className="hover:text-brand">Past collections</Link></li>
            <li><Link href="/login" className="hover:text-brand">Staff sign in</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-medium mb-2">Hear when the store opens</p>
          <NewsletterSignup />
        </div>
      </div>
    </footer>
  );
}
