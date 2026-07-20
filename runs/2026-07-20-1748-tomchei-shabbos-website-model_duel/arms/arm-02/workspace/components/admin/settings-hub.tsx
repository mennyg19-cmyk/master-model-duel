"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { OrdersTab } from "@/components/admin/settings/orders-tab";
import { ShippingTab } from "@/components/admin/settings/shipping-tab";
import { EmailTab } from "@/components/admin/settings/email-tab";
import { DeveloperTab } from "@/components/admin/settings/developer-tab";
import type { SettingsHubData } from "@/components/admin/settings/types";

export type { SettingsHubData } from "@/components/admin/settings/types";

// Settings hub shell: tab switching + the shared act/saveSetting plumbing.
// Each tab's forms live in components/admin/settings/*.tsx.

const TABS = ["Orders", "Shipping", "Email", "Developer"] as const;
type Tab = (typeof TABS)[number];

export function SettingsHub({ data }: { data: SettingsHubData }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Orders");
  const [message, setMessage] = useState<string | null>(null);

  async function act(action: () => Promise<{ ok: boolean; error?: string }>, successMessage = "Saved.") {
    setMessage(null);
    const outcome = await action();
    setMessage(outcome.ok ? successMessage : outcome.error ?? "Request failed.");
    if (outcome.ok) router.refresh();
  }

  const saveSetting = (key: string, value: unknown, successMessage?: string) =>
    act(() => apiFetch("/api/admin/settings", { method: "PATCH", body: { key, value } }), successMessage);

  return (
    <div className="space-y-5">
      <div role="tablist" className="flex gap-1 border-b border-border">
        {TABS.map((tabName) => (
          <button
            key={tabName}
            role="tab"
            aria-selected={tab === tabName}
            onClick={() => setTab(tabName)}
            className={`rounded-t-md px-4 py-2 text-sm font-medium ${
              tab === tabName ? "border border-b-0 border-border bg-surface text-brand-strong" : "text-muted hover:text-foreground"
            }`}
          >
            {tabName}
          </button>
        ))}
      </div>

      {message && <p className="rounded bg-brand-soft px-3 py-2 text-sm">{message}</p>}

      {tab === "Orders" && (
        <OrdersTab
          seasons={data.seasons}
          packageTypes={data.packageTypes}
          pickupLocations={data.pickupLocations}
          followupDays={data.followupDays}
          closedMessage={data.closedMessage}
          act={act}
          saveSetting={saveSetting}
        />
      )}
      {tab === "Shipping" && (
        <ShippingTab
          deliveryZips={data.deliveryZips}
          shippingRates={data.shippingRates}
          shippingRules={data.shippingRules}
          purimDayChoices={data.purimDayChoices}
          saveSetting={saveSetting}
        />
      )}
      {tab === "Email" && <EmailTab emailFrom={data.emailFrom} emailReplyTo={data.emailReplyTo} saveSetting={saveSetting} />}
      {tab === "Developer" && <DeveloperTab />}
    </div>
  );
}
