import Link from 'next/link';

import { getCurrentCustomer } from '@/lib/customers';

const ACCOUNT_NAV = [
  { href: '/account', label: 'Overview' },
  { href: '/account/orders', label: 'Orders' },
  { href: '/account/addresses', label: 'Address book' },
  { href: '/account/profile', label: 'Your details' },
];

export const dynamic = 'force-dynamic';

/** The nav only appears once there is an account to navigate: the sign-in page shares this route. */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const customer = await getCurrentCustomer();

  return (
    <div className="space-y-6">
      {customer ? (
        <nav aria-label="Account" className="flex flex-wrap gap-4 text-sm" data-testid="account-nav">
          {ACCOUNT_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="underline underline-offset-4">
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {children}
    </div>
  );
}
