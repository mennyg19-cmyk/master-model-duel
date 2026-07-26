import Link from 'next/link';

import { ListSearch, Pagination } from '@/components/admin/list-controls';
import { readPageRequest } from '@/lib/admin/list-query';
import { requirePermission } from '@/lib/auth/staff';
import { formatPhone } from '@/lib/core/phone';
import { listCustomerDirectory } from '@/lib/customers';
import { posBuilderPath } from '@/lib/pos/paths';

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/customers';

/**
 * The directory staff reach for when the phone rings (R-041, R-062).
 *
 * Paged rather than capped: by the week before Purim the org has more customers
 * than any one screen wants, and a search that silently stops at the fiftieth
 * match is worse than one that says which page you are on.
 */
export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; size?: string }>;
}) {
  const [params, staff] = await Promise.all([searchParams, requirePermission('customers.view')]);

  const query = (params.q ?? '').trim();
  const request = readPageRequest(params);
  const { rows, page } = await listCustomerDirectory(query, request);

  const canSell = staff.permissions.includes('orders.manage');

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Search by name, email or phone number.
        </p>
      </header>

      <ListSearch
        action={BASE_PATH}
        query={query}
        placeholder="Name, email or phone"
        pageSize={request.pageSize}
      />

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]" data-testid="customer-empty">
          No customer matches that.
        </p>
      ) : (
        <table className="w-full text-sm" data-testid="customer-table">
          <thead className="text-left text-[var(--color-ink-muted)]">
            <tr>
              <th className="py-2">Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Orders</th>
              <th>Recipients</th>
              {canSell ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((customer) => (
              <tr
                key={customer.id}
                className="border-t border-[var(--color-line)]"
                data-testid="customer-row"
              >
                <td className="py-2">
                  <Link
                    href={`${BASE_PATH}/${customer.id}`}
                    className="text-[var(--color-brand)] underline underline-offset-4"
                  >
                    {customer.fullName}
                  </Link>
                </td>
                <td>{customer.email}</td>
                <td>{customer.phone ? formatPhone(customer.phone) : '—'}</td>
                <td>{customer._count.orders}</td>
                <td>{customer._count.addresses}</td>
                {canSell ? (
                  <td className="text-right">
                    <Link
                      href={posBuilderPath(customer.id)}
                      className="underline underline-offset-4"
                      data-testid="customer-sell"
                    >
                      Ring up
                    </Link>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Pagination
        page={page}
        basePath={BASE_PATH}
        query={{ q: query, size: String(request.pageSize) }}
      />
    </div>
  );
}
