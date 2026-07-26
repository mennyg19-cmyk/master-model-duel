import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import { requirePermission } from '@/lib/auth/staff';
import { formatPhone } from '@/lib/core/phone';
import { searchCustomers } from '@/lib/customers';

export const dynamic = 'force-dynamic';

/** R-041. The directory staff reach for when the phone rings. */
export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ q }] = await Promise.all([searchParams, requirePermission('customers.view')]);
  const customers = await searchCustomers(q ?? '');

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Search by name, email or phone number.
        </p>
      </header>

      <form method="get" className="flex items-end gap-2">
        <div className="w-72">
          <Label htmlFor="q">Search</Label>
          <Input id="q" name="q" defaultValue={q ?? ''} placeholder="Name, email or phone" />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {customers.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]">No customer matches that.</p>
      ) : (
        <table className="w-full text-sm" data-testid="customer-table">
          <thead className="text-left text-[var(--color-ink-muted)]">
            <tr>
              <th className="py-2">Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Orders</th>
              <th>Recipients</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id} className="border-t border-[var(--color-line)]">
                <td className="py-2">
                  <Link
                    href={`/admin/customers/${customer.id}`}
                    className="text-[var(--color-brand)] underline underline-offset-4"
                  >
                    {customer.fullName}
                  </Link>
                </td>
                <td>{customer.email}</td>
                <td>{customer.phone ? formatPhone(customer.phone) : '—'}</td>
                <td>{customer._count.orders}</td>
                <td>{customer._count.addresses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
