"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
// m21: the shared server type — the client can never silently drift from the API.
import type { RerouteSuggestion } from "@/lib/routes/reroute";

// The route's working panel: driver-link create/rotate (raw URL shown ONCE —
// it is never stored), stop reassign between PLANNED routes, and the
// manager-confirmed reroute of nearby SHIPPED packages (G-027).
export function RouteActions({
  routeId,
  routeStatus,
  link,
  stops,
  reassignTargets,
}: {
  routeId: string;
  routeStatus: string;
  link: { expiresAt: string; hasPin: boolean } | null;
  stops: { id: string; seq: number; recipientName: string }[];
  reassignTargets: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [stopId, setStopId] = useState(stops[0]?.id ?? "");
  const [toRouteId, setToRouteId] = useState(reassignTargets[0]?.id ?? "");
  const [suggestions, setSuggestions] = useState<RerouteSuggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<{ ok: boolean; body: { error?: string } }>) {
    setBusy(label);
    setError(null);
    setNote(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) {
      setError(result.body.error ?? "Action failed");
      return false;
    }
    router.refresh();
    return true;
  }

  async function createLink(event: FormEvent) {
    event.preventDefault();
    const trimmedPin = pin.trim();
    const ok = await run("link", () =>
      apiFetch<{ rawUrl?: string; rotated?: boolean }>(`/api/admin/routes/${routeId}/link`, {
        method: "POST",
        body: trimmedPin ? { pin: trimmedPin } : {},
      }).then(async (result) => {
        if (result.ok && result.body.rawUrl) {
          setRawUrl(`${window.location.origin}${result.body.rawUrl}`);
          setNote(result.body.rotated ? "Link rotated — the previous URL is dead." : "Driver link created.");
        }
        return result;
      }),
    );
    if (ok) setPin("");
  }

  async function reassign(event: FormEvent) {
    event.preventDefault();
    await run("reassign", () =>
      apiFetch(`/api/admin/routes/${routeId}/reassign`, { method: "POST", body: { stopId, toRouteId } }).then((result) => {
        if (result.ok) setNote("Stop moved.");
        return result;
      }),
    );
  }

  async function loadSuggestions() {
    const result = await apiFetch<{ suggestions?: RerouteSuggestion[] }>(`/api/admin/routes/${routeId}/reroute`);
    if (result.ok) setSuggestions(result.body.suggestions ?? []);
    else setError(result.body.error ?? "Could not load suggestions");
  }

  async function confirmReroute(pkg: RerouteSuggestion) {
    const confirmed = window.confirm(
      `Reroute ${pkg.recipientName} (${pkg.address}) onto this route? A purchased label will be voided and the charge preserved.`,
    );
    if (!confirmed) return;
    await run(`reroute-${pkg.packageId}`, () =>
      apiFetch<{ voidedShipmentId?: string | null }>(`/api/admin/routes/${routeId}/reroute`, {
        method: "POST",
        body: { packageId: pkg.packageId, confirm: true },
      }).then((result) => {
        if (result.ok) {
          setNote(
            result.body.voidedShipmentId
              ? "Rerouted — the purchased label was voided."
              : "Rerouted onto this route.",
          );
          setSuggestions((current) => (current ?? []).filter((entry) => entry.packageId !== pkg.packageId));
        }
        return result;
      }),
    );
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-3">
      <Card className="p-5">
        <CardTitle>Driver link</CardTitle>
        {link ? (
          <p className="mt-2 text-sm text-stone-600" data-link-state>
            Link active until {new Date(link.expiresAt).toLocaleString()}
            {link.hasPin ? " · PIN protected" : ""}. Creating a new one rotates (kills) it.
          </p>
        ) : (
          <p className="mt-2 text-sm text-stone-600" data-link-state>No driver link yet.</p>
        )}
        <form onSubmit={createLink} className="mt-3 flex flex-wrap items-end gap-2" data-link-form>
          <div>
            <Label htmlFor="driver-pin">PIN (optional, 4 digits)</Label>
            <Input id="driver-pin" value={pin} onChange={(event) => setPin(event.target.value)} inputMode="numeric" maxLength={4} placeholder="1234" data-driver-pin />
          </div>
          <Button type="submit" disabled={busy === "link" || routeStatus === "COMPLETED"} data-link-create>
            {busy === "link" ? "Creating…" : link ? "Rotate link" : "Create link"}
          </Button>
        </form>
        {rawUrl && (
          <p className="mt-3 break-all rounded-md bg-accent-100 p-2 text-sm font-medium text-amber-900" data-driver-url>
            Text this to the driver now — it is never shown again: {rawUrl}
          </p>
        )}
      </Card>

      <Card className="p-5">
        <CardTitle>Reassign a stop</CardTitle>
        {reassignTargets.length === 0 || routeStatus !== "PLANNED" ? (
          <p className="mt-2 text-sm text-stone-500">
            {routeStatus !== "PLANNED"
              ? "Only PLANNED routes trade stops — a started route's manifest is fixed."
              : "No other PLANNED route to move stops to."}
          </p>
        ) : (
          <form onSubmit={reassign} className="mt-3 flex flex-col gap-2" data-reassign-form>
            <div>
              <Label htmlFor="reassign-stop">Stop</Label>
              <Select id="reassign-stop" value={stopId} onChange={(event) => setStopId(event.target.value)} className="w-full" data-reassign-stop>
                {stops.map((stop) => (
                  <option key={stop.id} value={stop.id}>
                    #{stop.seq} {stop.recipientName}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="reassign-target">To route</Label>
              <Select id="reassign-target" value={toRouteId} onChange={(event) => setToRouteId(event.target.value)} className="w-full" data-reassign-target>
                {reassignTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="secondary" disabled={busy === "reassign" || !stopId || !toRouteId} data-reassign-submit>
              {busy === "reassign" ? "Moving…" : "Move stop"}
            </Button>
          </form>
        )}
      </Card>

      <Card className="p-5">
        <CardTitle>Reroute nearby shipped orders</CardTitle>
        <p className="mt-2 text-sm text-stone-600">
          SHIPPED packages within half a mile of a stop, or on a stop&apos;s street. Each join needs your explicit
          confirm; a purchased label voids first.
        </p>
        <Button variant="secondary" className="mt-3" onClick={loadSuggestions} disabled={routeStatus !== "PLANNED"} data-reroute-scan>
          Scan for candidates
        </Button>
        <ul className="mt-3 flex flex-col gap-2 text-sm" data-reroute-list>
          {(suggestions ?? []).map((suggestion) => (
            <li key={suggestion.packageId} className="flex flex-wrap items-center justify-between gap-2" data-reroute-row={suggestion.packageId}>
              <span>
                <span className="font-medium">{suggestion.recipientName}</span> — {suggestion.address}{" "}
                <span className="text-xs text-stone-500">
                  ({suggestion.reason === "nearby" ? `${suggestion.distanceMiles ?? "?"} mi from stop #${suggestion.matchedStopSeq}` : `same street as stop #${suggestion.matchedStopSeq}`})
                </span>
              </span>
              <Button size="sm" onClick={() => confirmReroute(suggestion)} disabled={busy === `reroute-${suggestion.packageId}`} data-reroute-confirm={suggestion.packageId}>
                {busy === `reroute-${suggestion.packageId}` ? "Rerouting…" : "Reroute"}
              </Button>
            </li>
          ))}
          {suggestions !== null && suggestions.length === 0 && <li className="text-stone-500">No nearby shipped candidates.</li>}
        </ul>
      </Card>

      {(error || note) && (
        <p className={`lg:col-span-3 text-sm ${error ? "text-red-700" : "text-green-800"}`} data-route-action-message>
          {error ?? note}
        </p>
      )}
    </div>
  );
}
