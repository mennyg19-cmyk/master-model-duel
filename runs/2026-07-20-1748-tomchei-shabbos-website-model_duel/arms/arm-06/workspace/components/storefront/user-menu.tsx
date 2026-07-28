"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// Customer account area lands with ordering (P4); the menu is the header's
// account slot, wired to the pages that exist today.
export function UserMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="rounded-md p-2 text-brand-100 hover:bg-brand-700 hover:text-white"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <circle cx="10" cy="6.5" r="3" />
          <path d="M3.5 17c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-md border border-stone-200 bg-white py-1 shadow-lg">
          <Link
            href="/account"
            onClick={() => setIsOpen(false)}
            className="block px-4 py-2 text-sm text-stone-700 hover:bg-stone-100"
          >
            Sign in
          </Link>
          <Link
            href="/admin"
            onClick={() => setIsOpen(false)}
            className="block px-4 py-2 text-sm text-stone-700 hover:bg-stone-100"
          >
            Staff portal
          </Link>
        </div>
      )}
    </div>
  );
}
