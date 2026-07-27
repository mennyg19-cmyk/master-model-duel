"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/foundation";

type Account = {
  firstName: string;
  lastName: string;
  emailNormalized: string | null;
  addresses: { id: string; recipientName: string; line1: string; city: string; state: string; postalCode: string }[];
  orders: { id: string; draftReference: string; status: string; totalCents: number; updatedAt: string; lines: { quantity: number }[] }[];
};

export function AccountDashboard() {
  const [account, setAccount] = useState<Account | null>(null);
  const [openSeasonId, setOpenSeasonId] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading your account…");

  useEffect(() => {
    void fetch("/api/account").then(async (response) => {
      const body = await response.json() as { account?: Account; openSeason?: { id: string } | null; error?: string };
      if (!response.ok || !body.account) {
        setMessage(body.error ?? "Unable to load your account.");
        return;
      }
      setAccount(body.account);
      setOpenSeasonId(body.openSeason?.id ?? null);
      setMessage("");
    });
  }, []);

  async function repeatOrder(sourceOrderId: string) {
    if (!openSeasonId) return setMessage("Repeat ordering is unavailable while the store is closed.");
    const response = await fetch("/api/repeat", {
      method: "POST",
      headers: { "content-type": "application/json", origin: window.location.origin },
      body: JSON.stringify({ sourceOrderId, targetSeasonId: openSeasonId }),
    });
    const body = await response.json() as { draftId?: string; error?: string };
    if (!response.ok || !body.draftId) return setMessage(body.error ?? "Unable to prepare that repeat order.");
    window.location.assign(`/repeat/${body.draftId}`);
  }

  if (!account) return <p className="notice">{message}</p>;
  return (
    <>
      <p className="eyebrow">Your account</p>
      <h1>Welcome back, {account.firstName}.</h1>
      <div className="grid">
        <section className="card">
          <h2>Profile</h2>
          <p>{account.emailNormalized ?? "Add your email during checkout."}</p>
          <p>Profile details are visible only to your signed-in account.</p>
        </section>
        <section className="card">
          <h2>Saved addresses</h2>
          {account.addresses.length === 0 ? <p>Add a recipient while building an order.</p> : account.addresses.map((address) => <p key={address.id}><strong>{address.recipientName}</strong><br />{address.line1}, {address.city}, {address.state} {address.postalCode}</p>)}
        </section>
      </div>
      <section className="card account-orders">
        <h2>Orders</h2>
        {account.orders.length === 0 ? <p>No orders yet. <Link href="/order">Start an order</Link>.</p> : account.orders.map((order) => (
          <article className="order-history" key={order.id}>
            <div><strong>{order.draftReference}</strong><br />{order.lines.reduce((total, line) => total + line.quantity, 0)} gifts · {formatMoney(order.totalCents)}</div>
            <div><span>{order.status}</span>{order.status === "DRAFT" && <Link className="button secondary" href="/order">Continue or cancel</Link>}{order.status === "FINALIZED" && <button className="button secondary" disabled={!openSeasonId} onClick={() => void repeatOrder(order.id)} type="button">Repeat this order</button>}</div>
          </article>
        ))}
      </section>
    </>
  );
}
