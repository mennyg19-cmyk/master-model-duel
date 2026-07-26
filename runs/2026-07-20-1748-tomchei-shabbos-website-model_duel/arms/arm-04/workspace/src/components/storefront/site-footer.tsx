import Link from 'next/link';

import { NewsletterSignupForm } from './newsletter-signup-form';
import { STOREFRONT_NAV } from './nav-items';
import { BRAND } from '@/lib/brand';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-[var(--color-line)] bg-[var(--color-surface-muted)]">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-2">
        <div>
          <h2 className="text-base font-semibold">Stay in touch</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            One or two emails a season: when ordering opens, when it closes, and where the food went.
          </p>
          <NewsletterSignupForm source="footer" className="mt-4 max-w-md" />
        </div>

        <div className="text-sm text-[var(--color-ink-muted)] md:justify-self-end">
          <nav aria-label="Footer" className="flex flex-col gap-2">
            {STOREFRONT_NAV.map((item) => (
              <Link key={item.href} href={item.href} className="hover:underline underline-offset-4">
                {item.label}
              </Link>
            ))}
          </nav>
          <p className="mt-6">
            {BRAND.organization}
            <br />
            {BRAND.supportEmail}
            <br />
            {BRAND.supportPhone}
          </p>
        </div>
      </div>
    </footer>
  );
}
