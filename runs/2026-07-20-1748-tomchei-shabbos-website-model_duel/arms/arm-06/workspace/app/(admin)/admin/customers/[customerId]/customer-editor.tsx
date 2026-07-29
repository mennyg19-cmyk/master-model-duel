"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// R-062: identity edit (name/phone) on the customer detail. Email is the
// dedupe anchor — changing it is a merge decision, not an inline edit.
export function CustomerEditor({
  customer,
}: {
  customer: { id: string; name: string; email: string; phone: string | null };
}) {
  const router = useRouter();
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await apiFetch(`/api/admin/customers/${customer.id}`, {
      method: "PATCH",
      body: { name, phone: phone || null },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.body.error ?? "Could not save");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <Card className="p-5">
      <CardTitle>Identity</CardTitle>
      <form onSubmit={save} className="mt-3 flex flex-col gap-3" data-customer-editor>
        <div>
          <Label htmlFor="customer-name">Name</Label>
          <Input id="customer-name" className="mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} required />
        </div>
        <div>
          <Label htmlFor="customer-email">Email</Label>
          <Input id="customer-email" className="mt-1 w-full" value={customer.email} disabled />
          <p className="mt-1 text-xs text-stone-500">Email anchors dedupe — it can&apos;t be edited inline.</p>
        </div>
        <div>
          <Label htmlFor="customer-phone">Phone</Label>
          <Input id="customer-phone" className="mt-1 w-full" value={phone} onChange={(event) => setPhone(event.target.value)} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && <p className="text-sm text-green-700">Saved.</p>}
        <div>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
