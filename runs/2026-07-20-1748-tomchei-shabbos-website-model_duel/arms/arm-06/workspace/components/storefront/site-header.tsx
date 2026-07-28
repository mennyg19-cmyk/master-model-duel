import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { MobileMenu, NavLink } from "@/components/storefront/mobile-menu";
import { UserMenu } from "@/components/storefront/user-menu";

const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Home" },
  { href: "/packages", label: "Packages" },
  { href: "/past-collections", label: "Past Collections" },
];

// R-011: sticky header with desktop nav, mobile menu, and the user menu.
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 bg-brand-900 text-white shadow-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          {BRAND.orgName}
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-brand-100 hover:bg-brand-700 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <UserMenu />
          <MobileMenu links={NAV_LINKS} />
        </div>
      </div>
    </header>
  );
}
