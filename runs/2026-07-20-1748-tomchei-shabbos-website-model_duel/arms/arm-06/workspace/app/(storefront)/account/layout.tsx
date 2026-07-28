import Link from "next/link";
import { requireCustomer } from "@/lib/customers/session";
import { SignOutButton } from "./sign-out-button";

// R-038: account area, auth-gated. Every page below shares this nav; the
// customer context comes from the server-side session row (requireCustomer).
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCustomer();

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Your account</h1>
          <p className="mt-0.5 text-sm text-stone-500">{ctx.customer.email}</p>
        </div>
        <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Account">
          <AccountNavLink href="/account">Dashboard</AccountNavLink>
          <AccountNavLink href="/account/orders">Orders</AccountNavLink>
          <AccountNavLink href="/account/addresses">Addresses</AccountNavLink>
          <AccountNavLink href="/account/profile">Profile</AccountNavLink>
          <SignOutButton />
        </nav>
      </div>
      <div className="mt-8">{children}</div>
    </main>
  );
}

function AccountNavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"
    >
      {children}
    </Link>
  );
}
