"use client";

import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { SeasonStatusCard, NewSeasonCard } from "@/components/admin/settings/season-management";
import type { ActFn } from "@/components/admin/use-hub-act";
import type { PackageTypeRow, PickupLocationRow, SaveSettingFn, SeasonRow } from "@/components/admin/settings/types";

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
      <SeasonStatusCard seasons={seasons} closedMessage={closedMessage} act={act} saveSetting={saveSetting} />
      <NewSeasonCard seasons={seasons} act={act} />

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
