"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { formatMoney } from "@/lib/foundation";

type Order = { id: string; draftReference: string; orderNumber: number | null; status: string; totalCents: number; version: number; customer: { emailNormalized: string | null } | null; payments: { id: string; method: string; status: string }[] };
type Customer = { id: string; firstName: string; lastName: string; emailNormalized: string | null; phoneNormalized: string | null; _count: { orders: number } };

export default function OperationsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [summary, setSummary] = useState({ orderCount: 0, todayCount: 0, paidCents: 0 });
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [csv, setCsv] = useState("firstName,lastName,email\nAda,Import,ada.import@example.test");
  const [batchId, setBatchId] = useState("");

  async function load() {
    const [dashboard, orderList, customerList] = await Promise.all([
      fetch("/api/admin/operations").then((response) => response.json()),
      fetch(`/api/admin/operations?view=orders&q=${encodeURIComponent(query)}`).then((response) => response.json()),
      fetch(`/api/admin/operations?view=customers&q=${encodeURIComponent(query)}`).then((response) => response.json()),
    ]);
    if (dashboard.error || orderList.error || customerList.error) return setMessage(dashboard.error ?? orderList.error ?? customerList.error);
    setSummary(dashboard);
    setOrders(orderList.orders);
    setCustomers(customerList.customers);
  }

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch("/api/admin/operations", { signal: controller.signal }).then((response) => response.json()),
      fetch("/api/admin/operations?view=orders", { signal: controller.signal }).then((response) => response.json()),
      fetch("/api/admin/operations?view=customers", { signal: controller.signal }).then((response) => response.json()),
    ]).then(([dashboard, orderList, customerList]) => {
      if (controller.signal.aborted) return;
      if (dashboard.error || orderList.error || customerList.error) {
        setMessage(dashboard.error ?? orderList.error ?? customerList.error);
        return;
      }
      setSummary(dashboard);
      setOrders(orderList.orders);
      setCustomers(customerList.customers);
    });
    return () => controller.abort();
  }, []);

  async function stageImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/admin/imports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stage", kind: "customers", csv }) });
    const body = await response.json();
    setMessage(response.ok ? `Staged ${body.accepted} rows. ${body.errors.length} invalid.` : body.error);
    setBatchId(body.batchId ?? "");
  }

  async function commitImport() {
    const response = await fetch("/api/admin/imports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "commit", batchId }) });
    const body = await response.json();
    setMessage(response.ok ? `Imported ${body.imported} ${body.kind}.` : body.error);
    if (response.ok) { setBatchId(""); await load(); }
  }

  async function bulkVersionProbe() {
    const finalized = orders.filter((order) => order.status === "FINALIZED").slice(0, 100);
    const response = await fetch("/api/admin/operations", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "bulk", orderIds: finalized.map((order) => order.id), versions: Object.fromEntries(finalized.map((order) => [order.id, order.version])) }),
    });
    const body = await response.json();
    setMessage(response.ok ? `${body.outcomes.filter((outcome: { outcome: string }) => outcome.outcome === "processed").length} versions advanced; ${body.outcomes.filter((outcome: { outcome: string }) => outcome.outcome === "conflict").length} conflicts.` : body.error);
    await load();
  }

  return (
    <>
      <p className="eyebrow">Operations hub</p>
      <h1>Today&apos;s order desk</h1>
      <p className="lead">Search paid orders, resolve work waiting overnight, and keep walk-in sales and imports traceable.</p>
      <div className="grid">
        <section className="card"><h2>{summary.orderCount}</h2><p>Orders in this workspace</p></section>
        <section className="card"><h2>{summary.todayCount}</h2><p>Drafts waiting for follow-up</p></section>
        <section className="card"><h2>{formatMoney(summary.paidCents)}</h2><p>Posted payments</p></section>
      </div>
      <div className="tabs"><Link href="/admin/pos">Open POS</Link><a href="#orders">Orders</a><a href="#customers">Customers</a><a href="#import">Import</a></div>
      <label>Search orders or customers<input onChange={(event) => setQuery(event.target.value)} value={query} /></label>
      <button className="button secondary" onClick={() => void load()} type="button">Search</button>
      <section className="card ops-list" id="orders">
        <h2>Orders</h2>
        {orders.map((order) => <div className="ops-row" key={order.id}><a href={`/admin/orders/${order.id}`}>{order.orderNumber ? `#${order.orderNumber}` : order.draftReference} · {order.customer?.emailNormalized ?? "Guest"}</a><span>{formatMoney(order.totalCents)} · {order.status} · {order.payments.map((payment) => `${payment.method}/${payment.status}`).join(", ") || "unpaid"}</span></div>)}
        <button className="button secondary" onClick={() => void bulkVersionProbe()} type="button">Run bounded version-conflict probe</button>
      </section>
      <section className="card ops-list" id="customers">
        <h2>Customer directory</h2>
        {customers.map((customer) => <div className="ops-row" key={customer.id}><span>{customer.firstName} {customer.lastName}</span><span>{customer.emailNormalized ?? customer.phoneNormalized} · {customer._count.orders} orders</span></div>)}
      </section>
      <section className="card" id="import">
        <h2>Stage customer CSV</h2>
        <form onSubmit={stageImport}><textarea onChange={(event) => setCsv(event.target.value)} value={csv} /><button className="button" type="submit">Preview import</button></form>
        {batchId && <button className="button secondary" onClick={() => void commitImport()} type="button">Commit corrected import</button>}
      </section>
      {message && <p className="notice" role="status">{message}</p>}
    </>
  );
}
