"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

// Driver mobile client (UR-015, G-030): PIN gate, start route, stop cards
// with Google Maps deep links and the Delivered tap.

export function DriverPinForm({ token }: { token: string }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage(null);
        try {
          const result = await apiFetch(`/api/d/${token}/pin`, { body: { pin } });
          if (result.ok) router.refresh();
          else setMessage(result.error);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        value={pin}
        onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
        inputMode="numeric"
        autoFocus
        placeholder="••••"
        className="w-full rounded-md border border-border px-4 py-3 text-center text-2xl tracking-[0.5em]"
        data-testid="driver-pin-input"
      />
      <button
        type="submit"
        disabled={busy || pin.length !== 4}
        className="w-full rounded-md bg-brand-strong px-4 py-3 text-white disabled:opacity-50"
      >
        Open route
      </button>
      {message && <p className="text-sm text-danger" data-testid="driver-pin-error">{message}</p>}
    </form>
  );
}

export type DriverStop = {
  id: string;
  position: number;
  recipientName: string;
  addressText: string;
  mapsUrl: string;
  items: string[];
  delivered: boolean;
};

export function DriverRouteActions({
  token,
  routeStatus,
  stops,
}: {
  token: string;
  routeStatus: string;
  stops: DriverStop[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function act(id: string, path: string) {
    if (busy) return;
    setBusy(id);
    setMessage(null);
    try {
      const result = await apiFetch(path, { body: {} });
      if (result.ok) router.refresh();
      else setMessage(result.error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {routeStatus === "PLANNED" && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => act("start", `/api/d/${token}/start`)}
          className="w-full rounded-md bg-brand-strong px-4 py-3 text-white disabled:opacity-50"
          data-testid="driver-start-route"
        >
          Start route
        </button>
      )}
      {message && <p className="text-sm text-danger">{message}</p>}
      {stops.map((stop) => (
        <div
          key={stop.id}
          className={`rounded-lg border border-border p-4 ${stop.delivered ? "opacity-60" : "bg-surface"}`}
          data-testid="driver-stop-card"
        >
          <p className="font-semibold">
            {stop.position}. {stop.recipientName}
          </p>
          <p className="text-sm">{stop.addressText}</p>
          <ul className="mt-1 text-xs text-muted">
            {stop.items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <a
              href={stop.mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="flex-1 rounded-md border border-border px-3 py-2 text-center text-sm"
              data-testid="driver-maps-link"
            >
              Navigate
            </a>
            {stop.delivered ? (
              <span className="flex-1 rounded-md bg-green-100 px-3 py-2 text-center text-sm text-success">
                Delivered
              </span>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => act(stop.id, `/api/d/${token}/stops/${stop.id}/delivered`)}
                className="flex-1 rounded-md bg-brand-strong px-3 py-2 text-sm text-white disabled:opacity-50"
                data-testid="driver-delivered-button"
              >
                {busy === stop.id ? "Saving…" : "Delivered"}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
