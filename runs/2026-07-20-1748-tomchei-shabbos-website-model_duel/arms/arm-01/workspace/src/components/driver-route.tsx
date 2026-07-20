"use client";

import { useState } from "react";

type DriverRouteView = {
  id: string;
  name: string;
  status: string;
  stops: Array<{
    id: string;
    sequence: number;
    status: string;
    recipientName: string;
    greeting: string;
    address: string;
    googleMapsUrl: string;
  }>;
};

export function DriverRoute({ token }: { token: string }) {
  const [pin, setPin] = useState("");
  const [route, setRoute] = useState<DriverRouteView | null>(null);
  const [message, setMessage] = useState("");

  async function act(action: "open" | "start" | "deliver", stopId?: string) {
    const response = await fetch(`/api/driver/routes/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, pin: pin || undefined, stopId }),
    });
    const payload = (await response.json()) as {
      error?: string;
      completed?: boolean;
      route?: DriverRouteView;
    };
    if (!response.ok) {
      setMessage(payload.error ?? "Driver action failed.");
      return;
    }
    if (payload.completed) {
      setRoute(null);
      setMessage("Route complete. This link is now expired.");
      return;
    }
    setRoute(payload.route ?? null);
    setMessage(action === "start" ? "Route started. Customers were notified once." : "");
  }

  if (!route) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-[var(--border)] bg-white p-6 shadow-xl">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">Driver route</p>
        <h1 className="mt-2 text-3xl font-black">Open today&apos;s stops</h1>
        <label className="mt-6 block text-sm font-bold">
          Optional 4-digit PIN
          <input className="mt-2 w-full rounded-xl border p-3 text-lg" inputMode="numeric" maxLength={4} onChange={(event) => setPin(event.target.value)} type="password" value={pin} />
        </label>
        <button className="mt-4 w-full rounded-xl bg-[var(--brand)] p-3 font-bold text-white" onClick={() => void act("open")} type="button">Open route</button>
        {message && <p aria-live="polite" className="mt-4 font-semibold">{message}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">Driver route</p>
      <h1 className="mt-2 text-3xl font-black">{route.name}</h1>
      <button className="mt-4 w-full rounded-xl bg-[var(--ink)] p-3 font-bold text-white" onClick={() => void act("start")} type="button">Start route</button>
      <div className="mt-5 grid gap-4">
        {route.stops.map((stop) => (
          <article className="rounded-3xl border border-[var(--border)] bg-white p-5" key={stop.id}>
            <p className="text-sm font-bold text-[var(--muted)]">Stop {stop.sequence}</p>
            <h2 className="mt-1 text-2xl font-black">{stop.recipientName}</h2>
            <p className="mt-2">{stop.address}</p>
            <p className="mt-2 text-sm"><b>Card:</b> {stop.greeting || "No greeting"}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <a className="rounded-xl border border-[var(--brand)] p-3 text-center font-bold text-[var(--brand-dark)]" href={stop.googleMapsUrl}>Google Maps</a>
              <button className="rounded-xl bg-[var(--brand)] p-3 font-bold text-white disabled:opacity-50" disabled={stop.status === "DELIVERED"} onClick={() => void act("deliver", stop.id)} type="button">
                {stop.status === "DELIVERED" ? "Delivered" : "Mark delivered"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {message && <p aria-live="polite" className="sticky bottom-4 mt-4 rounded-xl bg-[var(--ink)] p-4 font-semibold text-white">{message}</p>}
    </div>
  );
}
