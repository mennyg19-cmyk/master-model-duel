"use client";

import { FormEvent, useEffect, useState } from "react";

type Route = {
  id: string;
  name: string;
  status: string;
  driver: { displayName: string } | null;
  stops: Array<{ id: string; sequence: number; deliveredAt: string | null; package: { recipientName: string } }>;
};

export default function DeliveryPage() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [name, setName] = useState("Neighborhood route");
  const [packageIds, setPackageIds] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const response = await fetch("/api/admin/delivery");
    const body = await response.json() as { routes?: Route[]; error?: string };
    if (!response.ok) return setMessage(body.error ?? "Delivery routes could not be loaded.");
    setRoutes(body.routes ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/admin/delivery")
      .then(async (response) => ({ response, body: await response.json() as { routes?: Route[]; error?: string } }))
      .then(({ response, body }) => {
        if (cancelled) return;
        if (!response.ok) return setMessage(body.error ?? "Delivery routes could not be loaded.");
        setRoutes(body.routes ?? []);
      });
    return () => { cancelled = true; };
  }, []);

  async function createRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/admin/delivery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create_route", name, packageIds: packageIds.split(",").map((id) => id.trim()).filter(Boolean), ...(pin ? { pin } : {}) }),
    });
    const body = await response.json() as { driverUrl?: string; error?: string };
    if (!response.ok) return setMessage(body.error ?? "Route could not be created.");
    setMessage(`Route created. Send the private driver URL: ${body.driverUrl}`);
    setPackageIds("");
    setPin("");
    await load();
  }

  return (
    <>
      <p className="eyebrow">Delivery operations</p>
      <h1>Routes, pickups, and delivery follow-up</h1>
      <p className="lead">Build a local-delivery route from package IDs, then share its private driver link outside this screen.</p>
      <section className="card">
        <h2>Build a route</h2>
        <form onSubmit={createRoute}>
          <label>Route name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Local-delivery package IDs, separated by commas<textarea value={packageIds} onChange={(event) => setPackageIds(event.target.value)} /></label>
          <label>Optional 4-digit PIN<input inputMode="numeric" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value)} /></label>
          <button className="button" type="submit">Create route</button>
        </form>
      </section>
      <section className="card ops-list">
        <h2>Routes</h2>
        {routes.map((route) => (
          <div className="ops-row" key={route.id}>
            <span>{route.name} · {route.status} · {route.driver?.displayName ?? "Unassigned"} · {route.stops.length} stops</span>
            <span>
              <a className="button secondary" href={`/api/admin/delivery/${route.id}`} rel="noopener noreferrer" target="_blank">Print route</a>
              <a className="button secondary" href={`/api/admin/delivery/${route.id}?print=greeting_cards`} rel="noopener noreferrer" target="_blank">Print cards</a>
            </span>
          </div>
        ))}
      </section>
      {message && <p className="notice" role="status">{message}</p>}
    </>
  );
}
