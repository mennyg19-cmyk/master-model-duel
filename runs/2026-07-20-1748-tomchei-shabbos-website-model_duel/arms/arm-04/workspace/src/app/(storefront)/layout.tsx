import Link from 'next/link';

import { BRAND } from '@/lib/brand';

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-brand)] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link href="/" className="text-lg font-semibold">
            {BRAND.organization}
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/admin">Staff sign in</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</main>

      <footer className="border-t border-[var(--color-line)] bg-[var(--color-surface-muted)]">
        <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-[var(--color-ink-muted)]">
          {BRAND.organization} · {BRAND.supportEmail} · {BRAND.supportPhone}
        </div>
      </footer>
    </div>
  );
}
