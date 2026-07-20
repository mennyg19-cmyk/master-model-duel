import Link from "next/link";
import { redirect } from "next/navigation";
import { getCustomerContext } from "@/lib/auth/customer-session";

const ACCOUNT_NAV = [
  { href: "/account", label: "Dashboard" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/addresses", label: "Address book" },
  { href: "/account/profile", label: "Profile" },
];

// Auth gate for the whole account area (R-038): no session → sign-in page.
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const customer = await getCustomerContext();
  if (!customer) redirect("/signin");

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 gap-8 px-4 py-8 sm:px-6">
      <nav className="hidden w-44 shrink-0 sm:block" aria-label="Account">
        <ul className="flex flex-col gap-1 text-sm">
          {ACCOUNT_NAV.map((entry) => (
            <li key={entry.href}>
              <Link href={entry.href} className="block rounded px-2 py-1.5 hover:bg-brand-soft">
                {entry.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1">
        <nav className="mb-4 flex gap-3 text-sm sm:hidden" aria-label="Account (mobile)">
          {ACCOUNT_NAV.map((entry) => (
            <Link key={entry.href} href={entry.href} className="text-brand hover:underline">
              {entry.label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </main>
  );
}
