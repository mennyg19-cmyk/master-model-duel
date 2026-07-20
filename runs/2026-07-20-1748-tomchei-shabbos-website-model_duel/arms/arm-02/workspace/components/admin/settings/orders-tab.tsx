"use client";

import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import type { ActFn, PackageTypeRow, PickupLocationRow, SaveSettingFn, SeasonRow } from "@/components/admin/settings/types";

export function OrdersTab({
  seasons,
  packageTypes,
  pickupLocations,
  followupDays,
  closedMessage,
  act,
  saveSetting,
}: {
  seasons: SeasonRow[];
  packageTypes: PackageTypeRow[];
  pickupLocations: PickupLocationRow[];
  followupDays: number;
  closedMessage: string;
  act: ActFn;
  saveSetting: SaveSettingFn;
}) {
  const [newPackageType, setNewPackageType] = useState("");
  const [newLocation, setNewLocation] = useState({ name: "", line1: "", city: "", state: "", zip: "" });
  const [followup, setFollowup] = useState(String(followupDays));
  const [closed, setClosed] = useState(closedMessage);

  async function addPackageType(event: FormEvent) {
    event.preventDefault();
    await act(() => apiFetch("/api/admin/package-types", { method: "POST", body: { name: newPackageType } }));
    setNewPackageType("");
  }

  async function addLocation(event: FormEvent) {
    event.preventDefault();
    await act(() => apiFetch("/api/admin/pickup-locations", { method: "POST", body: newLocation }));
    setNewLocation({ name: "", line1: "", city: "", state: "", zip: "" });
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardTitle>Store status</CardTitle>
        <p className="mb-3 text-sm text-muted">
          The storefront sells from the open season. Closing it hides checkout everywhere on the next request.
        </p>
        <ul className="space-y-2 text-sm">
          {seasons.map((season) => (
            <li key={season.id} className="flex items-center gap-3">
              <span className="font-medium">{season.name}</span>
              <Badge tone={season.status === "OPEN" ? "success" : "neutral"}>{season.status}</Badge>
              <Button
                variant="secondary"
                className="ml-auto"
                onClick={() =>
                  act(
                    () =>
                      apiFetch("/api/admin/season-status", {
                        method: "PATCH",
                        body: { seasonId: season.id, status: season.status === "OPEN" ? "CLOSED" : "OPEN" },
                      }),
                    `${season.name} is now ${season.status === "OPEN" ? "closed" : "open"}.`
                  )
                }
              >
                {season.status === "OPEN" ? "Close store" : "Open store"}
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-border pt-3">
          <label htmlFor="closed-message" className="text-sm font-medium">Storewide closed banner</label>
          <div className="mt-1 flex gap-2">
            <Input id="closed-message" value={closed} onChange={(event) => setClosed(event.target.value)} className="flex-1" />
            <Button onClick={() => saveSetting("store.closed_message", closed)}>Save</Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Package types</CardTitle>
        <ul className="space-y-1 text-sm">
          {packageTypes.map((packageType) => (
            <li key={packageType.id} className="flex items-center gap-3">
              {packageType.name}
              <Button
                variant="danger"
                className="ml-auto"
                onClick={() =>
                  act(() => apiFetch(`/api/admin/package-types/${packageType.id}`, { method: "DELETE", body: {} }), "Package type removed.")
                }
              >
                Remove
              </Button>
            </li>
          ))}
          {packageTypes.length === 0 && <li className="text-muted">None yet.</li>}
        </ul>
        <form onSubmit={addPackageType} className="mt-3 flex gap-2">
          <Input required value={newPackageType} onChange={(event) => setNewPackageType(event.target.value)} placeholder="Small gift box" className="flex-1" />
          <Button type="submit">Add</Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Pickup locations</CardTitle>
        <ul className="space-y-1 text-sm">
          {pickupLocations.map((location) => (
            <li key={location.id} className="flex items-center gap-3">
              <span>
                {location.name} — {location.line1}, {location.city} {location.zip}
              </span>
              <Badge tone={location.isActive ? "success" : "neutral"}>{location.isActive ? "Active" : "Inactive"}</Badge>
              <Button
                variant="secondary"
                className="ml-auto"
                onClick={() =>
                  act(() =>
                    apiFetch(`/api/admin/pickup-locations/${location.id}`, { method: "PATCH", body: { isActive: !location.isActive } })
                  )
                }
              >
                {location.isActive ? "Deactivate" : "Activate"}
              </Button>
            </li>
          ))}
          {pickupLocations.length === 0 && <li className="text-muted">None yet.</li>}
        </ul>
        <form onSubmit={addLocation} className="mt-3 flex flex-wrap gap-2">
          <Input required placeholder="Name" value={newLocation.name} onChange={(event) => setNewLocation({ ...newLocation, name: event.target.value })} />
          <Input required placeholder="Street" value={newLocation.line1} onChange={(event) => setNewLocation({ ...newLocation, line1: event.target.value })} />
          <Input required placeholder="City" value={newLocation.city} onChange={(event) => setNewLocation({ ...newLocation, city: event.target.value })} className="w-28" />
          <Input required placeholder="ST" maxLength={2} value={newLocation.state} onChange={(event) => setNewLocation({ ...newLocation, state: event.target.value.toUpperCase() })} className="w-14" />
          <Input required placeholder="ZIP" maxLength={5} value={newLocation.zip} onChange={(event) => setNewLocation({ ...newLocation, zip: event.target.value })} className="w-20" />
          <Button type="submit">Add</Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Follow-up</CardTitle>
        <label htmlFor="followup-days" className="text-sm">Days after delivery before the follow-up email</label>
        <div className="mt-1 flex gap-2">
          <Input id="followup-days" type="number" min="0" value={followup} onChange={(event) => setFollowup(event.target.value)} className="w-24" />
          <Button onClick={() => saveSetting("orders.followup_days", Number(followup))}>Save</Button>
        </div>
      </Card>
    </div>
  );
}
