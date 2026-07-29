"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

// R-079: pick the manager-set day + optional window, schedule. The response
// carries the notified channel counts so the UI proves "one email + one SMS
// per customer" without opening the outbox.
export function BulkScheduleForm({ deliveryDays, disabled }: { deliveryDays: string[]; disabled: boolean }) {
  const router = useRouter();
  const [deliveryDay, setDeliveryDay] = useState(deliveryDays[0] ?? "");
  const [deliveryWindow, setDeliveryWindow] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function schedule(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    const result = await apiFetch<{ packageCount?: number; customerCount?: number; notifiedChannels?: { email: number; sms: number } }>(
      "/api/admin/bulk-schedules",
      { method: "POST", body: { deliveryDay, ...(deliveryWindow.trim() ? { window: deliveryWindow.trim() } : {}) } },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.body.error ?? "Scheduling failed");
      return;
    }
    setNote(
      `Scheduled ${result.body.packageCount} package(s) for ${result.body.customerCount} customer(s) — ${result.body.notifiedChannels?.email ?? 0} email(s), ${result.body.notifiedChannels?.sms ?? 0} SMS sent.`,
    );
    router.refresh();
  }

  if (deliveryDays.length === 0) {
    return <p className="mt-3 text-sm text-stone-500">Set delivery days in Settings before scheduling bulk runs.</p>;
  }

  return (
    <form onSubmit={schedule} className="mt-3 flex flex-wrap items-end gap-3" data-bulk-form>
      <div>
        <Label htmlFor="bulk-day">Delivery day</Label>
        <Select id="bulk-day" value={deliveryDay} onChange={(event) => setDeliveryDay(event.target.value)} data-bulk-day>
          {deliveryDays.map((day) => (
            <option key={day} value={day}>
              {day}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="bulk-window">Window (optional)</Label>
        <Input id="bulk-window" value={deliveryWindow} onChange={(event) => setDeliveryWindow(event.target.value)} placeholder="10:00–14:00" data-bulk-window />
      </div>
      <Button type="submit" disabled={busy || disabled} data-bulk-schedule>
        {busy ? "Scheduling…" : disabled ? "Nothing to schedule" : "Schedule & notify"}
      </Button>
      {error && <p className="w-full text-sm text-red-700" data-bulk-error>{error}</p>}
      {note && <p className="w-full text-sm text-green-800" data-bulk-note>{note}</p>}
    </form>
  );
}
