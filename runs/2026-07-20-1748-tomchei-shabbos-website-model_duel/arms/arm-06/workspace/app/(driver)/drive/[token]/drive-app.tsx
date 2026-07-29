"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BRAND } from "@/lib/brand";

interface DriverStopCard {
  stopId: string;
  seq: number;
  recipientName: string;
  address: { line1: string; line2: string | null; city: string; region: string; postalCode: string };
  mapsUrl: string;
  contents: string[];
  deliveredAt: string | null;
}

interface DriverRouteView {
  routeId: string;
  name: string;
  deliveryDay: string | null;
  status: string;
  stops: DriverStopCard[];
}

// G-030: the driver's phone UI. Big tap targets, one card per stop, Google
// Maps deep links for turn-by-turn, Delivered stamps inline. "Start route"
// fires the day-of notifications (exactly once — a re-tap is a quiet no-op).
export function DriveApp({ token, pinRequired: pinRequiredInitial }: { token: string; pinRequired: boolean }) {
  const [view, setView] = useState<DriverRouteView | null>(null);
  const [pinRequired, setPinRequired] = useState(pinRequiredInitial);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<string | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await apiFetch<{ route?: DriverRouteView }>(`/api/drive/${token}`);
    setBusy(null);
    if (result.ok && result.body.route) {
      setView(result.body.route);
      return;
    }
    if (result.status === 403) {
      setPinRequired(true);
      return;
    }
    setError(result.body.error ?? "Could not load the route");
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function submitPin(event: FormEvent) {
    event.preventDefault();
    setBusy("pin");
    setError(null);
    const result = await apiFetch(`/api/drive/${token}/pin`, { method: "POST", body: { pin } });
    setBusy(null);
    if (!result.ok) {
      setError(result.body.error ?? "Wrong PIN");
      return;
    }
    setPinRequired(false);
    setBusy("load");
    await refresh();
  }

  async function startRoute() {
    setBusy("start");
    setError(null);
    setNote(null);
    const result = await apiFetch<{ alreadyStarted?: boolean; notifiedCustomers?: number }>(`/api/drive/${token}/start`, { method: "POST" });
    setBusy(null);
    if (!result.ok) {
      setError(result.body.error ?? "Could not start the route");
      return;
    }
    setNote(result.body.alreadyStarted ? "Route already started — no duplicate notifications sent." : `Route started — ${result.body.notifiedCustomers ?? 0} customer(s) notified.`);
    await refresh();
  }

  async function deliver(stopId: string) {
    setBusy(`deliver-${stopId}`);
    setError(null);
    setNote(null);
    const result = await apiFetch<{ alreadyDelivered?: boolean; routeCompleted?: boolean }>(`/api/drive/${token}/deliver`, {
      method: "POST",
      body: { stopId },
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.body.error ?? "Could not mark delivered");
      return;
    }
    if (result.body.routeCompleted) setNote("Last stop delivered — route complete. This link is now closed.");
    await refresh();
  }

  if (pinRequired) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6">
        <Card className="w-full max-w-md p-8">
          <CardTitle>Enter your PIN</CardTitle>
          <p className="mt-2 text-sm text-stone-600">The coordinator texted you a 4-digit PIN for this route.</p>
          <form onSubmit={submitPin} className="mt-4 flex flex-col gap-3" data-pin-form>
            <div>
              <Label htmlFor="pin">4-digit PIN</Label>
              <Input id="pin" value={pin} onChange={(event) => setPin(event.target.value)} inputMode="numeric" maxLength={4} autoFocus data-pin-input />
            </div>
            <Button type="submit" disabled={busy === "pin" || pin.length !== 4} data-pin-submit>
              {busy === "pin" ? "Checking…" : "Unlock route"}
            </Button>
            {error && <p className="text-sm text-red-700" data-pin-error>{error}</p>}
          </form>
        </Card>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6">
        <Card className="w-full max-w-md p-8 text-center">
          <CardTitle>{error ? "Something went wrong" : "Loading route…"}</CardTitle>
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        </Card>
      </main>
    );
  }

  const remaining = view.stops.filter((stop) => stop.deliveredAt === null).length;

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6" data-drive-app>
      <div className="mx-auto max-w-lg">
        <h1 className="text-xl font-semibold">{view.name}</h1>
        <p className="mt-1 text-sm text-stone-600">
          {view.deliveryDay ?? "Delivery run"} · {remaining} of {view.stops.length} stop(s) to go
        </p>

        {view.status === "PLANNED" && (
          <Button className="mt-4 w-full py-3 text-base" onClick={startRoute} disabled={busy === "start"} data-start-route>
            {busy === "start" ? "Starting…" : "Start route"}
          </Button>
        )}
        {note && <p className="mt-3 rounded-md bg-green-50 p-2 text-sm text-green-800" data-drive-note>{note}</p>}
        {error && <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700" data-drive-error>{error}</p>}

        <ul className="mt-5 flex flex-col gap-4" data-stop-cards>
          {view.stops.map((stop) => (
            <li key={stop.stopId} data-stop-card={stop.stopId}>
              <Card className={`p-4 ${stop.deliveredAt ? "opacity-70" : ""}`}>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold">
                    #{stop.seq} {stop.recipientName}
                  </span>
                  {stop.deliveredAt && (
                    <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800" data-stop-stamp>
                      DELIVERED
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-stone-700">
                  {stop.address.line1}
                  {stop.address.line2 ? `, ${stop.address.line2}` : ""}
                  <br />
                  {stop.address.city}, {stop.address.region} {stop.address.postalCode}
                </p>
                <ul className="mt-2 text-xs text-stone-500">
                  {stop.contents.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2">
                  <a
                    href={stop.mapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex flex-1 items-center justify-center rounded-md border border-stone-300 bg-white px-3 py-2.5 text-sm font-medium text-stone-900 hover:bg-stone-100"
                    data-stop-navigate={stop.stopId}
                  >
                    Navigate
                  </a>
                  {!stop.deliveredAt && view.status === "STARTED" && (
                    <Button className="flex-1 py-2.5" onClick={() => deliver(stop.stopId)} disabled={busy === `deliver-${stop.stopId}`} data-stop-deliver={stop.stopId}>
                      {busy === `deliver-${stop.stopId}` ? "Marking…" : "Mark delivered"}
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-center text-xs text-stone-400">{BRAND.orgName}</p>
      </div>
    </main>
  );
}
