"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ManagedAddOn {
  id: string;
  name: string;
  slug: string;
  priceCents: number;
  active: boolean;
  productCount: number;
}

export function AddonManager({ addOns }: { addOns: ManagedAddOn[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const { ok, body } = await apiFetch("/api/admin/addons", {
      method: "POST",
      body: {
        name: String(form.get("name") ?? ""),
        priceDollars: Number(String(form.get("priceDollars") ?? "0")),
      },
    });
    setIsSaving(false);

    if (!ok) {
      setError(body.error ?? "Could not create the add-on");
      return;
    }
    (event.target as HTMLFormElement).reset();
    router.refresh();
  }

  async function patch(id: string, payload: Record<string, unknown>) {
    setError(null);
    const { ok, body } = await apiFetch(`/api/admin/addons/${id}`, { method: "PATCH", body: payload });
    if (!ok) {
      setError(body.error ?? "Could not update the add-on");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-6">
      <form onSubmit={onCreate} className="flex flex-wrap items-end gap-2 rounded-md border border-stone-200 bg-white p-4">
        <Input name="name" placeholder="Add-on name" required className="max-w-xs" />
        <Input name="priceDollars" type="number" step="0.01" min="0" placeholder="$0.00" required className="max-w-[8rem]" />
        <Button type="submit" size="sm" disabled={isSaving}>
          {isSaving ? "Adding…" : "Add add-on"}
        </Button>
      </form>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Price</th>
            <th className="py-2 pr-4">Used by</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {addOns.map((addOn) => (
            <tr key={addOn.id} className="border-b border-stone-100">
              <td className="py-2.5 pr-4 font-medium text-stone-900">{addOn.name}</td>
              <td className="py-2.5 pr-4">{formatCents(addOn.priceCents)}</td>
              <td className="py-2.5 pr-4 text-stone-600">
                {addOn.productCount} product{addOn.productCount === 1 ? "" : "s"}
              </td>
              <td className="py-2.5 pr-4">
                {addOn.active ? <Badge tone="green">Active</Badge> : <Badge tone="stone">Hidden</Badge>}
              </td>
              <td className="py-2.5 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => patch(addOn.id, { active: !addOn.active })}
                >
                  {addOn.active ? "Deactivate" : "Activate"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
