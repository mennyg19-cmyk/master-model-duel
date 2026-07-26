import Link from 'next/link';

import { signOut } from '@/app/sign-in/actions';
import { getStaffContext } from '@/lib/auth/staff';

/**
 * The storefront half of the identity chrome. Customer accounts arrive with the
 * order builder (P4), so today this menu answers one question honestly: is a
 * staff member signed in on this browser, and where do they go next?
 */
export async function UserMenu() {
  const context = await getStaffContext();

  if (!context) {
    return (
      <Link href="/sign-in" className="underline underline-offset-4">
        Staff sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3" data-testid="user-menu">
      <span className="hidden sm:inline">{context.acting.fullName}</span>
      <Link href="/admin" className="underline underline-offset-4">
        Admin
      </Link>
      <form action={signOut}>
        <button type="submit" className="underline underline-offset-4">
          Sign out
        </button>
      </form>
    </div>
  );
}
