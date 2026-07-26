import Link from 'next/link';

import { AddressBookForm } from './address-book-form';
import { archiveAddressAction } from '../actions';
import { requireSignedInCustomer } from '../session';
import { listCustomerAddresses } from '@/lib/addresses/address-book';
import { addressSummary } from '@/lib/addresses/address-summary';
import { formatPhone } from '@/lib/core/phone';

export const dynamic = 'force-dynamic';

/**
 * UR-014. One book per customer, shared by the builder and this page: what is
 * saved here is what the assignment picker offers, and what the picker saves on
 * the way past appears here.
 */
export default async function AddressesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; notice?: string; problem?: string }>;
}) {
  const [params, customer] = await Promise.all([
    searchParams,
    requireSignedInCustomer('/account/addresses'),
  ]);

  const addresses = await listCustomerAddresses(customer.id);
  const editing = params.edit
    ? (addresses.find((address) => address.id === params.edit) ?? null)
    : null;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Address book</h1>
        <p className="text-[var(--color-ink-muted)]">
          Everyone you have sent a package to. Saved here once, offered every time you build an
          order.
        </p>
      </header>

      {params.notice ? (
        <p
          className="rounded-md bg-[var(--color-success-soft)] px-3 py-2 text-sm text-[var(--color-success)]"
          data-testid="addresses-notice"
        >
          {params.notice}
        </p>
      ) : null}

      {params.problem ? (
        <p
          role="alert"
          className="rounded-md bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
          data-testid="addresses-problem"
        >
          {params.problem}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Saved recipients</h2>

          {addresses.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-muted)]">
              Nothing saved yet. Add someone here, or add them while building an order.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="address-list">
              {addresses.map((address) => (
                <li
                  key={address.id}
                  className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4"
                  data-testid="address-row"
                  data-address-id={address.id}
                  data-geocoded={address.geocodedAt === null ? 'false' : 'true'}
                >
                  <p className="font-medium">
                    {address.recipientName}
                    {address.label ? ` · ${address.label}` : ''}
                  </p>
                  <p className="text-sm text-[var(--color-ink-muted)]">{addressSummary(address)}</p>
                  {address.phone ? (
                    <p className="text-sm text-[var(--color-ink-muted)]">
                      {formatPhone(address.phone)}
                    </p>
                  ) : null}

                  <div className="mt-2 flex items-center gap-4 text-sm">
                    <Link
                      href={`/account/addresses?edit=${address.id}`}
                      className="text-[var(--color-brand)] underline underline-offset-4"
                      data-testid="address-edit"
                    >
                      Edit
                    </Link>
                    <form action={archiveAddressAction}>
                      <input type="hidden" name="addressId" value={address.id} />
                      <button
                        type="submit"
                        className="underline underline-offset-4"
                        data-testid="address-archive"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <AddressBookForm
          editing={editing}
          knownRecipients={addresses.map((address) => address.recipientName)}
        />
      </div>
    </div>
  );
}
