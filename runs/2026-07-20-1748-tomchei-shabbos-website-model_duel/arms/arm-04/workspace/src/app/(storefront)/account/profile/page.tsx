import { ProfileForm } from './profile-form';
import { requireSignedInCustomer } from '../session';
import { formatPhone } from '@/lib/core/phone';

export const dynamic = 'force-dynamic';

/**
 * R-042. The form has no customer id in it: the action edits whichever customer
 * the session resolves to, so there is nothing to tamper with.
 */
export default async function ProfilePage() {
  const customer = await requireSignedInCustomer('/account/profile');

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Your details</h1>
        <p className="text-[var(--color-ink-muted)]">
          We use these to reach you about an order. Your email is managed by your sign-in and cannot
          be changed here.
        </p>
      </header>

      <p className="text-sm text-[var(--color-ink-muted)]" data-testid="profile-email">
        Signed in as {customer.email}
      </p>

      <ProfileForm
        fullName={customer.fullName}
        phone={customer.phone ? formatPhone(customer.phone) : ''}
      />
    </div>
  );
}
