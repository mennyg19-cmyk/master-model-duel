"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type AddOn = {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  isRestricted: boolean;
  isActive: boolean;
  inventory: { onHand: number } | null;
};

const emptyForm = () => ({
  id: "",
  sku: "",
  name: "",
  priceCents: 1000,
  isRestricted: false,
  onHand: 5,
});

export function AddOnAdmin() {
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());

  async function load() {
    const res = await fetch("/api/admin/addons");
    const json = await res.json();
    if (res.ok) setAddOns(json.addOns);
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/addons", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: form.id || undefined,
        sku: form.sku,
        name: form.name,
        priceCents: form.priceCents,
        isRestricted: form.isRestricted,
        onHand: form.onHand,
      }),
    });
    const json = await res.json();
    setMessage(res.ok ? `Saved ${json.addOn.name}` : json.error || "Failed");
    if (res.ok) {
      setForm(emptyForm());
      await load();
    }
  }

  function edit(addOn: AddOn) {
    setForm({
      id: addOn.id,
      sku: addOn.sku,
      name: addOn.name,
      priceCents: addOn.priceCents,
      isRestricted: addOn.isRestricted,
      onHand: addOn.inventory?.onHand ?? 0,
    });
  }

  async function remove(addOn: AddOn) {
    if (!window.confirm(`Delete ${addOn.name}?`)) return;
    const res = await fetch("/api/admin/addons", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: addOn.id }),
    });
    const json = await res.json();
    setMessage(res.ok ? `Deleted ${addOn.name}` : json.error || "Delete failed");
    if (res.ok) {
      if (form.id === addOn.id) setForm(emptyForm());
      await load();
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="grid gap-3 rounded bg-white p-4 shadow-sm md:grid-cols-2">
        <h2 className="md:col-span-2 font-semibold">{form.id ? "Edit add-on" : "New add-on"}</h2>
        <input
          className="rounded border px-2 py-1.5 text-sm"
          placeholder="SKU"
          value={form.sku}
          onChange={(e) => setForm({ ...form, sku: e.target.value })}
          required
        />
        <input
          className="rounded border px-2 py-1.5 text-sm"
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <input
          type="number"
          className="rounded border px-2 py-1.5 text-sm"
          value={form.priceCents}
          onChange={(e) => setForm({ ...form, priceCents: Number(e.target.value) })}
        />
        <input
          type="number"
          className="rounded border px-2 py-1.5 text-sm"
          value={form.onHand}
          onChange={(e) => setForm({ ...form, onHand: Number(e.target.value) })}
          placeholder="On hand"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isRestricted}
            onChange={(e) => setForm({ ...form, isRestricted: e.target.checked })}
          />
          Restricted
        </label>
        <Button type="submit">Save add-on</Button>
        {message ? <p className="md:col-span-2 text-sm">{message}</p> : null}
      </form>
      <ul className="space-y-1 text-sm" data-testid="admin-addon-list">
        {addOns.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white px-3 py-2 shadow-sm">
            <span>
              {a.name} · {a.sku} · ${(a.priceCents / 100).toFixed(2)}
              {a.isRestricted ? " · restricted" : ""}
              {a.inventory ? ` · on hand ${a.inventory.onHand}` : ""}
            </span>
            <span className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => edit(a)}>
                Edit
              </Button>
              <Button type="button" variant="secondary" onClick={() => void remove(a)}>
                Delete
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
