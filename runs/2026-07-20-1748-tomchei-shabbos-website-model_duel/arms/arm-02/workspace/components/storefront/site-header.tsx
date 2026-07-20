"use client";

import { useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/cn";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/catalog", label: "Shop" },
  { href: "/collections", label: "Past Collections" },
];

export function SiteHeader({ storeOpen }: { storeOpen: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="font-bold text-brand-strong">
          {BRAND.shortName}
          <span className="ml-2 hidden text-xs font-normal text-muted sm:inline">Mishloach Manos</span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm font-medium md:flex" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-brand">
              {link.label}
            </Link>
          ))}
          {storeOpen && (
            <Link
              href="/order"
              className="rounded-md bg-brand px-3 py-1.5 text-white transition-colors hover:bg-brand-strong"
            >
              Start an order
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              aria-label="Account menu"
              aria-expanded={userMenuOpen}
              onClick={() => setUserMenuOpen((open) => !open)}
              className="rounded-full border border-border bg-surface p-2 text-sm hover:bg-brand-soft"
            >
              {/* Simple person glyph, no icon package needed */}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <circle cx="8" cy="5" r="3" />
                <path d="M2 14c0-3 2.7-4.5 6-4.5s6 1.5 6 4.5v.5H2Z" />
              </svg>
            </button>
            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-48 rounded-md border border-border bg-surface p-2 text-sm shadow-lg">
                <p className="px-2 py-1 text-xs text-muted">
                  Customer accounts arrive with ordering.
                </p>
                <Link href="/login" className="block rounded px-2 py-1.5 hover:bg-brand-soft">
                  Staff sign in
                </Link>
              </div>
            )}
          </div>

          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
            className="rounded-md border border-border p-2 md:hidden"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <rect y="2" width="16" height="2" rx="1" />
              <rect y="7" width="16" height="2" rx="1" />
              <rect y="12" width="16" height="2" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      <nav
        className={cn("border-t border-border px-4 py-2 md:hidden", !mobileOpen && "hidden")}
        aria-label="Mobile"
      >
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={() => setMobileOpen(false)}
            className="block rounded px-2 py-2 text-sm font-medium hover:bg-brand-soft"
          >
            {link.label}
          </Link>
        ))}
        {storeOpen && (
          <Link
            href="/order"
            onClick={() => setMobileOpen(false)}
            className="mt-1 block rounded bg-brand px-2 py-2 text-sm font-medium text-white"
          >
            Start an order
          </Link>
        )}
      </nav>
    </header>
  );
}
