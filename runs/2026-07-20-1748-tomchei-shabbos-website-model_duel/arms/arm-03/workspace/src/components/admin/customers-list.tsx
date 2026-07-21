"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type CustomerRow = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  _count: { orders: number; addresses: number };
};

export function CustomersListClient() {
  const [q, setQ] = useState("");
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/admin/customers?${params}`);
    const json = await res.json();
    if (res.ok) {
      setCustomers(json.customers);
      setTotalPages(json.totalPages);
    }
  }, [page, q]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4" data-testid="customers-list">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          void load();
        }}
      >
        <input
          className="flex-1 rounded border px-3 py-2 text-sm"
          placeholder="Search name, email, phone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="customers-search"
        />
        <Button type="submit">Search</Button>
      </form>
      <ul className="divide-y rounded bg-white shadow-sm">
        {customers.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <Link href={`/admin/customers/${c.id}`} className="font-semibold underline">
              {c.displayName}
            </Link>
            <span className="text-xs opacity-70">
              {c.email ?? c.phone ?? "—"} · {c._count.orders} orders
            </span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Prev
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
