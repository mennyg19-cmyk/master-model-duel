"use client";

import { useParams } from "next/navigation";
import { useState } from "react";

type DriverRoute = {
  route: { name: string; status: string; startedAt: string | null };
  stops: Array<{ id: string; sequence: number; recipientName: string; greeting: string; deliveredAt: string | null; address: string; mapUrl: string | null }>;
};

export default function DriverRoutePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [pin, setPin] = useState("");
  const [route, setRoute] = useState<DriverRoute | null>(null);
  const [message, setMessage] = useState("Enter the route PIN only if one was provided.");

  async function request(action: Record<string, string>) {
    const response = await fetch(`/api/driver/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...action, ...(pin ? { pin } : {}) }),
    });
    const body = await response.json() as DriverRoute & { error?: string };
    if (!response.ok) {
      setMessage(body.error ?? "Route could not be opened.");
      return;
    }
    if (action.action !== "read") return load();
    setRoute(body);
    setMessage("");
  }

  async function load() {
    await request({ action: "read" });
  }

  return (
    <main className="container">
      <p className="eyebrow">Driver route</p>
      <h1>{route?.route.name ?? "Open your delivery route"}</h1>
      {!route && <label>Route PIN (if provided)<input inputMode="numeric" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value)} /></label>}
      {!route && <button className="button" onClick={() => void load()} type="button">Open stops</button>}
      {route && (
        <>
          <button className="button" disabled={route.route.status !== "DRAFT"} onClick={() => void request({ action: "start" })} type="button">Start route</button>
          <section className="ops-list">
            {route.stops.map((stop) => (
              <article className="card" key={stop.id}>
                <h2>{stop.sequence}. {stop.recipientName}</h2>
                <p>{stop.address}</p>
                <p>{stop.greeting}</p>
                {stop.mapUrl && <a className="button secondary" href={stop.mapUrl} rel="noopener noreferrer" target="_blank">Open Google Maps</a>}
                <button className="button" disabled={Boolean(stop.deliveredAt)} onClick={() => void request({ action: "deliver", stopId: stop.id })} type="button">{stop.deliveredAt ? "Delivered" : "Mark delivered"}</button>
              </article>
            ))}
          </section>
        </>
      )}
      {message && <p className="notice" role="status">{message}</p>}
    </main>
  );
}
