"use client";

import Link from "next/link";
import { useState } from "react";
import { brand } from "@/lib/brand";

const navigation = [
  { href: "/catalog", label: "Purim gifts" },
  { href: "/collections", label: "Past collections" },
  { href: "/account", label: "My account" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#impact", label: "Our impact" },
];

export function StorefrontHeader({ isOpen }: { isOpen: boolean }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <>
      {!isOpen && (
        <div className="bg-[var(--ink)] px-4 py-2.5 text-center text-sm font-semibold text-white">
          This season is closed. Past collections remain open for browsing.
        </div>
      )}
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5">
          <Link href="/" className="leading-tight">
            <span className="block text-lg font-extrabold text-[var(--ink)]">
              {brand.name}
            </span>
            <span className="text-[0.65rem] font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
              {brand.program}
            </span>
          </Link>
          <nav className="hidden items-center gap-7 lg:flex" aria-label="Main navigation">
            {navigation.map((entry) => (
              <Link
                className="text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--brand)]"
                href={entry.href}
                key={entry.href}
              >
                {entry.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-3 sm:flex">
            <Link
              className="rounded-full px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface)]"
              href="/account"
            >
              Account
            </Link>
            <Link
              className="rounded-full bg-[var(--brand)] px-5 py-2.5 text-sm font-bold text-white"
              href={isOpen ? "/catalog" : "/collections"}
            >
              {isOpen ? "Shop Purim" : "Browse archive"}
            </Link>
          </div>
          <button
            aria-expanded={isMenuOpen}
            aria-label="Toggle navigation"
            className="grid size-11 place-items-center rounded-full border border-[var(--border)] lg:hidden"
            onClick={() => setIsMenuOpen((current) => !current)}
            type="button"
          >
            <span aria-hidden="true" className="text-xl">
              {isMenuOpen ? "×" : "☰"}
            </span>
          </button>
        </div>
        {isMenuOpen && (
          <nav className="border-t border-[var(--border)] bg-white px-5 py-4 lg:hidden">
            {navigation.map((entry) => (
              <Link
                className="block rounded-xl px-3 py-3 font-semibold hover:bg-[var(--surface)]"
                href={entry.href}
                key={entry.href}
                onClick={() => setIsMenuOpen(false)}
              >
                {entry.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
    </>
  );
}
