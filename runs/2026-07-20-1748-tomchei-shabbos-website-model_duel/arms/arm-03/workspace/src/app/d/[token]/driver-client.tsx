"use client";

import { useCallback, useEffect, useState } from "react";

type Stop = {
  id: string;
  sequence: number;
  status: string;
  recipientName: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  mapsUrl: string;
};

export function DriverMagicClient({ token }: { token: string }) {
  const [pin, setPin] = useState("");
  const [pinRequired, setPinRequired] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [routeName, setRouteName] = useState("");
  const [routeStatus, setRouteStatus] = useState("");
  const [stops, setStops] = useState<Stop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [linkId, setLinkId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/driver/${token}`);
    const json = await res.json();
    if (!res.ok) {
      if (res.status === 410) setExpired(true);
      setError(json.error || "Failed to load route");
      return;
    }
    setLinkId(json.linkId);
    setPinRequired(Boolean(json.pinRequired));
    setRouteName(json.route.name);
    setRouteStatus(json.route.status);
    setStops(json.stops);
    if (!json.pinRequired) setUnlocked(true);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function verifyPin() {
    const res = await fetch(`/api/driver/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify-pin", pin }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.throttled ? "PIN locked — wait and retry" : "Wrong PIN");
      return;
    }
    setUnlocked(true);
    setError(null);
  }

  async function startRoute() {
    const res = await fetch(`/api/driver/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", pin: pin || undefined }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Could not start");
      return;
    }
    setRouteStatus(json.route.status);
    await load();
  }

  async function deliver(stopId: string) {
    const res = await fetch(`/api/driver/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deliver", stopId, pin: pin || undefined }),
    });
    const json = await res.json();
    if (!res.ok) {
      if (res.status === 410) setExpired(true);
      setError(json.error || "Deliver failed");
      return;
    }
    if (json.completed) {
      setExpired(true);
      setRouteStatus("COMPLETED");
    }
    await load();
  }

  if (expired) {
    return (
      <main className="mx-auto max-w-md p-4" data-testid="driver-expired">
        <h1 className="text-2xl font-bold text-[var(--color-forest)]">Link expired</h1>
        <p className="mt-2 text-sm">This route is complete. Thank you.</p>
        {linkId ? <p className="mt-1 text-xs opacity-60">link {linkId}</p> : null}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-4 p-4" data-testid="driver-magic">
      <header>
        <p className="text-xs uppercase tracking-wide text-[var(--color-leaf)]">Driver</p>
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          {routeName || "Route"}
        </h1>
        <p className="text-sm opacity-70">{routeStatus}</p>
      </header>

      {pinRequired && !unlocked ? (
        <div className="rounded-[var(--radius-md)] bg-white p-4 shadow-sm">
          <label className="text-sm font-medium">Enter PIN</label>
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            data-testid="driver-pin"
          />
          <button
            type="button"
            className="mt-3 w-full rounded bg-[var(--color-forest)] px-3 py-2 text-white"
            onClick={() => void verifyPin()}
          >
            Unlock
          </button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {unlocked ? (
        <>
          {routeStatus !== "IN_PROGRESS" && routeStatus !== "COMPLETED" ? (
            <button
              type="button"
              className="w-full rounded bg-[var(--color-leaf)] px-3 py-3 font-semibold text-white"
              onClick={() => void startRoute()}
              data-testid="driver-start"
            >
              Start route
            </button>
          ) : null}

          <ul className="space-y-3">
            {stops.map((stop) => (
              <li
                key={stop.id}
                className="rounded-[var(--radius-md)] bg-white p-4 shadow-sm"
                data-testid={`driver-stop-${stop.sequence}`}
              >
                <p className="font-semibold">
                  {stop.sequence}. {stop.recipientName}
                </p>
                <p className="text-sm">
                  {stop.addressLine1}
                  {stop.addressLine2 ? `, ${stop.addressLine2}` : ""}
                </p>
                <p className="text-sm">
                  {stop.city}, {stop.state} {stop.postalCode}
                </p>
                <a
                  className="mt-2 inline-block text-sm font-semibold text-[var(--color-leaf)]"
                  href={stop.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  data-testid={`maps-link-${stop.id}`}
                >
                  Open in Google Maps
                </a>
                {stop.status === "PENDING" ? (
                  <button
                    type="button"
                    className="mt-3 w-full rounded border border-[var(--color-forest)] px-3 py-2 text-sm font-semibold"
                    onClick={() => void deliver(stop.id)}
                    data-testid={`deliver-${stop.id}`}
                  >
                    Mark delivered
                  </button>
                ) : (
                  <p className="mt-2 text-xs font-semibold text-[var(--color-leaf)]">Delivered</p>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </main>
  );
}
