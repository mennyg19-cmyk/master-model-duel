"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, type ApiResult } from "@/lib/api-client";

// Client controls for route admin (R-074..R-076, G-023): build a route,
// start it, reassign the driver, mint magic links, mark stops delivered from
// the printed fallback, and confirm reroutes.

const button = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-brand-soft disabled:opacity-50";
const smallButton = "rounded-md border border-border px-2 py-0.5 text-xs hover:bg-brand-soft disabled:opacity-50";
const input = "rounded-md border border-border px-2 py-1.5 text-sm";

function useAct() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function act<T>(request: () => Promise<ApiResult<T>>, note: string): Promise<ApiResult<T> | null> {
    if (busy) return null;
    setBusy(true);
    setMessage(null);
    try {
      const result = await request();
      setMessage(result.ok ? note : result.error);
      if (result.ok) router.refresh();
      return result;
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, act };
}

export function RouteBuilder({ methods }: { methods: { id: string; name: string }[] }) {
  const router = useRouter();
  const { busy, message, act } = useAct();
  const [methodId, setMethodId] = useState(methods[0]?.id ?? "");
  const [name, setName] = useState("");

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await act(
          () => apiFetch<{ routeId: string }>("/api/admin/routes", { body: { methodId, name: name || undefined } }),
          "Route created."
        );
        if (result?.ok && result.body) router.push(`/admin/routes/${result.body.routeId}`);
      }}
    >
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Delivery method</span>
        <select value={methodId} onChange={(event) => setMethodId(event.target.value)} className={input}>
          {methods.map((method) => (
            <option key={method.id} value={method.id}>{method.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Name (optional)</span>
        <input value={name} onChange={(event) => setName(event.target.value)} className={input} placeholder="Route 1" />
      </label>
      <button type="submit" disabled={busy || !methodId} className={button}>Build route</button>
      {message && <p className="text-sm text-muted">{message}</p>}
    </form>
  );
}

export function StartRouteButton({ routeId }: { routeId: string }) {
  const { busy, message, act } = useAct();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className={button}
        onClick={() => act(() => apiFetch(`/api/admin/routes/${routeId}/start`, { body: {} }), "Route started — day-of notifications sent.")}
      >
        Start route
      </button>
      {message && <span className="text-xs text-muted">{message}</span>}
    </span>
  );
}

export function DriverAssign({
  routeId,
  drivers,
  currentDriverId,
}: {
  routeId: string;
  drivers: { id: string; name: string }[];
  currentDriverId: string | null;
}) {
  const { busy, message, act } = useAct();
  return (
    <span className="inline-flex items-center gap-2">
      <select
        defaultValue={currentDriverId ?? ""}
        disabled={busy}
        className={input}
        onChange={(event) =>
          act(
            () => apiFetch(`/api/admin/routes/${routeId}`, { method: "PATCH", body: { driverStaffId: event.target.value || null } }),
            "Driver updated."
          )
        }
      >
        <option value="">Unassigned</option>
        {drivers.map((driver) => (
          <option key={driver.id} value={driver.id}>{driver.name}</option>
        ))}
      </select>
      {message && <span className="text-xs text-muted">{message}</span>}
    </span>
  );
}

export function RouteLinkPanel({ routeId }: { routeId: string }) {
  const { busy, message, act } = useAct();
  const [pin, setPin] = useState("");
  const [url, setUrl] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Optional 4-digit PIN (text it to the driver)</span>
          <input
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
            className={input}
            placeholder="No PIN"
            inputMode="numeric"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          className={button}
          onClick={async () => {
            const result = await act(
              () => apiFetch<{ url: string }>(`/api/admin/routes/${routeId}/link`, { body: { pin: pin || null } }),
              "Magic link created — older links are now dead."
            );
            if (result?.ok && result.body) setUrl(result.body.url);
          }}
        >
          Create magic link
        </button>
      </div>
      {url && (
        <p className="break-all rounded bg-brand-soft px-3 py-2 text-sm" data-testid="magic-link-url">
          {url}
        </p>
      )}
      {message && <p className="text-xs text-muted">{message}</p>}
    </div>
  );
}

export function StopDeliveredButton({ routeId, stopId }: { routeId: string; stopId: string }) {
  const { busy, message, act } = useAct();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className={smallButton}
        onClick={() =>
          act(() => apiFetch(`/api/admin/routes/${routeId}/stops/${stopId}/delivered`, { body: {} }), "Marked delivered.")
        }
      >
        Mark delivered
      </button>
      {message && <span className="text-xs text-muted">{message}</span>}
    </span>
  );
}

export function RerouteConfirmButton({
  routeId,
  packageId,
  label,
}: {
  routeId: string;
  packageId: string;
  label: string;
}) {
  const { busy, message, act } = useAct();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className={smallButton}
        onClick={() => {
          // Manager confirm is mandatory (G-023): the suggestion never acts alone.
          if (!window.confirm(`Reroute ${label} onto this route? Its shipping label will be voided.`)) return;
          act(() => apiFetch(`/api/admin/routes/${routeId}/reroute`, { body: { packageId } }), "Package rerouted onto this route.");
        }}
      >
        Add to route…
      </button>
      {message && <span className="text-xs text-muted">{message}</span>}
    </span>
  );
}
