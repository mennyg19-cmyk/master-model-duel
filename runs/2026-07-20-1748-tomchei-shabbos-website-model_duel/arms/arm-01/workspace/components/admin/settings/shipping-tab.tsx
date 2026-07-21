"use client";

import { useState } from "react";
import { formatCents } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import type { SaveSettingFn, ShippingRate, ShippingRules } from "@/components/admin/settings/types";

export function ShippingTab({
  deliveryZips,
  shippingRates,
  shippingRules,
  purimDayChoices,
  saveSetting,
}: {
  deliveryZips: string[];
  shippingRates: ShippingRate[];
  shippingRules: ShippingRules;
  purimDayChoices: string[];
  saveSetting: SaveSettingFn;
}) {
  const [zipsText, setZipsText] = useState(deliveryZips.join(", "));
  const [rates, setRates] = useState(shippingRates);
  const [rules, setRules] = useState(shippingRules);
  const [newRate, setNewRate] = useState({ name: "", price: "" });
  const [dayChoicesText, setDayChoicesText] = useState(purimDayChoices.join("\n"));

  function saveZips() {
    const zips = zipsText.split(",").map((zip) => zip.trim()).filter(Boolean);
    void saveSetting("shipping.delivery_zips", zips, "Delivery ZIPs saved — checkout blocking updates immediately.");
  }

  function saveDayChoices() {
    const choices = dayChoicesText.split("\n").map((choice) => choice.trim()).filter(Boolean);
    void saveSetting("delivery.purim_day_choices", choices, "Delivery day choices saved — checkout offers them immediately.");
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardTitle>Local delivery ZIP codes</CardTitle>
        <p className="mb-2 text-sm text-muted">
          Per-package delivery is hard-blocked outside these ZIPs (G-014). Changes apply on the next request.
        </p>
        <div className="flex gap-2">
          <Input value={zipsText} onChange={(event) => setZipsText(event.target.value)} placeholder="08701, 08527" className="flex-1" />
          <Button onClick={saveZips}>Save ZIPs</Button>
        </div>
      </Card>

      <Card>
        <CardTitle>Delivery rates</CardTitle>
        <p className="mb-2 text-sm text-muted">Placeholder rates until live carrier quotes land (P8).</p>
        <ul className="space-y-1 text-sm">
          {rates.map((rate, index) => (
            <li key={`${rate.name}-${index}`} className="flex items-center gap-3">
              {rate.name} — {formatCents(rate.amountCents)}
              <Button variant="danger" className="ml-auto" onClick={() => setRates(rates.filter((_, i) => i !== index))}>
                Remove
              </Button>
            </li>
          ))}
          {rates.length === 0 && <li className="text-muted">No rates configured.</li>}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Input placeholder="Rate name" value={newRate.name} onChange={(event) => setNewRate({ ...newRate, name: event.target.value })} />
          <Input placeholder="$" type="number" step="0.01" min="0" value={newRate.price} onChange={(event) => setNewRate({ ...newRate, price: event.target.value })} className="w-24" />
          <Button
            variant="secondary"
            onClick={() => {
              if (!newRate.name || newRate.price === "") return;
              setRates([...rates, { name: newRate.name, amountCents: Math.round(Number(newRate.price) * 100) }]);
              setNewRate({ name: "", price: "" });
            }}
          >
            Add row
          </Button>
          <Button onClick={() => saveSetting("shipping.rates", rates)}>Save rates</Button>
        </div>
      </Card>

      <Card>
        <CardTitle>Delivery fee rules</CardTitle>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label>
            Bulk: fee per destination ($)
            <Input
              type="number"
              step="0.01"
              min="0"
              value={(rules.bulkFeePerDestinationCents / 100).toString()}
              onChange={(event) => setRules({ ...rules, bulkFeePerDestinationCents: Math.round(Number(event.target.value) * 100) })}
              className="mt-1 block w-28"
            />
          </label>
          <label>
            Per-package fee ($)
            <Input
              type="number"
              step="0.01"
              min="0"
              value={(rules.perPackageFeeCents / 100).toString()}
              onChange={(event) => setRules({ ...rules, perPackageFeeCents: Math.round(Number(event.target.value) * 100) })}
              className="mt-1 block w-28"
            />
          </label>
          <Button onClick={() => saveSetting("shipping.rules", rules)}>Save rules</Button>
        </div>
      </Card>

      <Card>
        <CardTitle>Purim delivery day choices</CardTitle>
        <p className="mb-2 text-sm text-muted">
          One per line (UR-009). Checkout requires a pick whenever an order uses per-package delivery.
        </p>
        <textarea
          value={dayChoicesText}
          onChange={(event) => setDayChoicesText(event.target.value)}
          rows={4}
          className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-ink"
        />
        <Button className="mt-2" onClick={saveDayChoices}>Save day choices</Button>
      </Card>
    </div>
  );
}
