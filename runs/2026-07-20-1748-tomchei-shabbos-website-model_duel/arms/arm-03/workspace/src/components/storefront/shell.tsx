"use client";

import Link from "next/link";
import { useState } from "react";
import { brand } from "@/lib/brand";
import { NewsletterForm } from "@/components/storefront/newsletter-form";

const NAV = [
  { href: "/catalog", label: "Shop" },
  { href: "/archive", label: "Past collections" },
  { href: "/about", label: "About" },
  { href: "/newsletter", label: "Newsletter" },
];

export function StorefrontShell({
  children,
  storeOpen,
  seasonName,
}: {
  children: React.ReactNode;
  storeOpen: boolean;
  seasonName?: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--color-cream)] text-[var(--color-ink)]" data-store-open={storeOpen}>
      {!storeOpen ? (
        <div
          className="bg-[var(--color-accent)] px-4 py-2 text-center text-sm font-semibold text-white"
          data-testid="store-closed-banner"
        >
          The store is closed{seasonName ? ` for ${seasonName}` : ""}. You can browse the catalog and
          archive; ordering opens with the next season.
        </div>
      ) : null}

      <header className="sticky top-0 z-40 border-b border-[var(--color-forest)]/10 bg-[var(--color-cream)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="font-[family-name:var(--font-display)] text-2xl text-[var(--color-forest)]">
            {brand.name}
          </Link>
          <nav className="hidden items-center gap-5 md:flex" aria-label="Primary">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="text-sm font-semibold hover:text-[var(--color-leaf)]">
                {item.label}
              </Link>
            ))}
            {storeOpen ? (
              <Link
                href="/order"
                className="rounded-[var(--radius-md)] bg-[var(--color-leaf)] px-3 py-1.5 text-sm font-semibold text-white"
                data-testid="order-cta"
              >
                Order
              </Link>
            ) : null}
            <Link href="/account" className="text-sm font-semibold text-[var(--color-forest)]/80">
              Account
            </Link>
          </nav>
          <button
            type="button"
            className="rounded-[var(--radius-md)] border border-[var(--color-forest)]/20 px-3 py-1.5 text-sm font-semibold md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            Menu
          </button>
        </div>
        {open ? (
          <nav id="mobile-nav" className="border-t border-[var(--color-forest)]/10 px-4 py-3 md:hidden">
            <ul className="flex flex-col gap-2">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="block py-1 text-sm font-semibold" onClick={() => setOpen(false)}>
                    {item.label}
                  </Link>
                </li>
              ))}
              {storeOpen ? (
                <li>
                  <Link href="/order" className="block py-1 text-sm font-semibold" onClick={() => setOpen(false)}>
                    Order
                  </Link>
                </li>
              ) : null}
              <li>
                <Link href="/account" className="block py-1 text-sm font-semibold" onClick={() => setOpen(false)}>
                  Account
                </Link>
              </li>
            </ul>
          </nav>
        ) : null}
      </header>

      {children}

      <footer className="mt-16 border-t border-[var(--color-forest)]/10 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-[family-name:var(--font-display)] text-xl text-[var(--color-forest)]">{brand.name}</p>
            <p className="mt-1 max-w-md text-sm text-[var(--color-ink)]/70">{brand.tagline}</p>
          </div>
          <NewsletterForm compact />
        </div>
      </footer>
    </div>
  );
}
