"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatCents } from "@/lib/storefront/catalog-shared";

type AccountPayload = {
  profile: {
    id: string;
    displayName: string;
    email: string | null;
    phone: string | null;
  };
  addresses: Array<{
    id: string;
    label: string | null;
    recipientName: string;
    line1: string;
    city: string;
    state: string;
    postalCode: string;
    latitude: number | null;
    longitude: number | null;
    geocodeStatus: string | null;
    addressNorm: string;
  }>;
  drafts: Array<{
    id: string;
    draftRef: string;
    seasonName: string;
    lineCount: number;
    subtotalCents: number;
    updatedAt: string;
  }>;
  orders: Array<{
    id: string;
    draftRef: string;
    orderNumber: number | null;
    status: string;
    seasonName: string;
    lineCount: number;
    placedAt: string | null;
  }>;
};

export function AccountDashboard() {
  const [data, setData] = useState<AccountPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/account");
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json.error || "Sign in required");
      return;
    }
    setData(json);
    setName(json.profile.displayName);
    setPhone(json.profile.phone || "");
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveProfile() {
    const res = await fetch("/api/account/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: name, phone }),
    });
    const json = await res.json();
    if (!json.ok) {
      setMsg(json.error || "Could not save");
      return;
    }
    setMsg("Profile saved");
    await load();
  }

  async function cancelDraft(draftRef: string) {
    await fetch(`/api/drafts/${draftRef}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    await load();
  }

  if (error) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center" data-testid="account-signed-out">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Account
        </h1>
        <p className="mt-3 text-sm text-[var(--color-ink)]/75">{error}</p>
        <p className="mt-2 text-sm">Sign in as a customer to manage drafts and addresses.</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center text-sm">Loading account…</main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-10 px-4 py-10" data-testid="account-dashboard">
      <header>
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Your account
        </h1>
        <p className="mt-1 text-sm text-[var(--color-ink)]/70">{data.profile.email}</p>
      </header>

      <section className="rounded-[var(--radius-lg)] border bg-white p-5" data-testid="account-profile">
        <h2 className="font-semibold">Profile</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Display name
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="profile-name"
            />
          </label>
          <label className="text-sm">
            Phone
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              data-testid="profile-phone"
            />
          </label>
        </div>
        <button
          type="button"
          className="mt-3 rounded bg-[var(--color-leaf)] px-3 py-2 text-sm font-semibold text-white"
          onClick={saveProfile}
          data-testid="profile-save"
        >
          Save profile
        </button>
        {msg ? <p className="mt-2 text-sm text-[var(--color-leaf)]">{msg}</p> : null}
      </section>

      <section data-testid="account-drafts">
        <h2 className="font-semibold">Open drafts</h2>
        {data.drafts.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-ink)]/60">No open drafts.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.drafts.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border bg-white p-3"
              >
                <div>
                  <p className="text-sm font-semibold">{d.draftRef}</p>
                  <p className="text-xs text-[var(--color-ink)]/60">
                    {d.seasonName} · {d.lineCount} lines · {formatCents(d.subtotalCents)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    href="/order"
                    className="rounded bg-[var(--color-forest)] px-3 py-1.5 text-xs font-semibold text-white"
                    data-testid={`continue-${d.draftRef}`}
                  >
                    Continue
                  </Link>
                  <span
                    className="rounded border px-3 py-1.5 text-xs font-semibold opacity-50"
                    title="Checkout / pay ships in P5"
                  >
                    Pay (P5)
                  </span>
                  <button
                    type="button"
                    className="rounded border px-3 py-1.5 text-xs font-semibold text-red-700"
                    onClick={() => cancelDraft(d.draftRef)}
                    data-testid={`cancel-${d.draftRef}`}
                  >
                    Cancel
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="account-orders">
        <h2 className="font-semibold">Order history</h2>
        {data.orders.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-ink)]/60">No placed orders yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.orders.map((o) => (
              <li key={o.id} className="rounded border bg-white p-3">
                <Link
                  href={`/account/orders/${o.id}`}
                  className="text-sm font-semibold text-[var(--color-forest)]"
                >
                  Order #{o.orderNumber ?? o.draftRef} — {o.status}
                </Link>
                <p className="text-xs text-[var(--color-ink)]/60">
                  {o.seasonName} · {o.lineCount} lines
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="account-addresses">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Saved addresses</h2>
          <Link href="/account/addresses" className="text-sm font-semibold text-[var(--color-leaf)]">
            Manage
          </Link>
        </div>
        <ul className="mt-3 space-y-2">
          {data.addresses.map((a) => (
            <li key={a.id} className="rounded border bg-white p-3 text-sm" data-testid={`addr-${a.id}`}>
              <p className="font-semibold">
                {a.label || a.recipientName}
              </p>
              <p>
                {a.line1}, {a.city} {a.state} {a.postalCode}
              </p>
              <p className="text-xs text-[var(--color-ink)]/50">
                geocode: {a.geocodeStatus ?? "—"}
                {a.latitude != null ? ` (${a.latitude}, ${a.longitude})` : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
