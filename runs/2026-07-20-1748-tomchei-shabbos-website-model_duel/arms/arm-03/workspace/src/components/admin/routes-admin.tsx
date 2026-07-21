"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type RouteRow = {
  id: string;
  name: string;
  status: string;
  _count: { stops: number };
  driver: { displayName: string } | null;
  magicLinks: { id: string }[];
};

export function RoutesAdminClient() {
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [name, setName] = useState("Route A");
  const [packageIds, setPackageIds] = useState("");
  const [pin, setPin] = useState("1234");
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/admin/routes");
    const json = await res.json();
    if (res.ok) setRoutes(json.routes || []);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createRoute() {
    setMessage(null);
    const res = await fetch("/api/admin/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        packageIds: packageIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        pin: pin || null,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "Create failed");
      return;
    }
    setMessage(`Created ${json.route.id}`);
    await refresh();
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Delivery routes
        </h1>
        <p className="text-sm opacity-70">Mapbox-style builder (geocode + cache), magic links, print.</p>
      </header>

      <section className="rounded-[var(--radius-md)] bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Build route</h2>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <input
            className="rounded border px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Route name"
          />
          <input
            className="rounded border px-3 py-2 text-sm"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Optional 4-digit PIN"
          />
          <input
            className="rounded border px-3 py-2 text-sm md:col-span-2"
            value={packageIds}
            onChange={(e) => setPackageIds(e.target.value)}
            placeholder="Package ids (comma-separated)"
          />
        </div>
        <button
          type="button"
          className="mt-3 rounded bg-[var(--color-forest)] px-4 py-2 text-sm text-white"
          onClick={() => void createRoute()}
        >
          Create
        </button>
        {message ? <p className="mt-2 text-sm">{message}</p> : null}
      </section>

      <ul className="space-y-2">
        {routes.map((route) => (
          <li key={route.id} className="rounded bg-white p-3 shadow-sm">
            <Link href={`/admin/routes/${route.id}`} className="font-semibold hover:underline">
              {route.name}
            </Link>
            <p className="text-xs opacity-70">
              {route.status} · {route._count.stops} stops ·{" "}
              {route.driver?.displayName ?? "unassigned"}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
