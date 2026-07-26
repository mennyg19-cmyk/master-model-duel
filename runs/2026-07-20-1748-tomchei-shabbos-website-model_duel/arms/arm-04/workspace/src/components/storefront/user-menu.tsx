import Link from 'next/link';

import { signOut } from '@/app/sign-in/actions';
import { getStaffContext } from '@/lib/auth/staff';
import { getCurrentCustomer } from '@/lib/customers';

/**
 * The identity chrome answers for both kinds of account (UR-012). Staff are
 * checked first: a staff member browsing the storefront wants the way back to the
 * admin, not a customer dashboard they do not have.
 */
export async function UserMenu() {
  const context = await getStaffContext();

  if (context) {
    return (
      <div className="flex items-center gap-3" data-testid="user-menu">
        <span className="hidden sm:inline">{context.acting.fullName}</span>
        <Link href="/admin" className="underline underline-offset-4">
          Admin
        </Link>
        <SignOutButton />
      </div>
    );
  }

  const customer = await getCurrentCustomer();

  if (customer) {
    return (
      <div className="flex items-center gap-3" data-testid="user-menu">
        <Link href="/account" className="underline underline-offset-4" data-testid="account-link">
          {customer.fullName}
        </Link>
        <SignOutButton />
      </div>
    );
  }

  return (
    <Link href="/account/sign-in" className="underline underline-offset-4" data-testid="sign-in-link">
      Sign in
    </Link>
  );
}

function SignOutButton() {
  return (
    <form action={signOut}>
      <button type="submit" className="underline underline-offset-4">
        Sign out
      </button>
    </form>
  );
}
