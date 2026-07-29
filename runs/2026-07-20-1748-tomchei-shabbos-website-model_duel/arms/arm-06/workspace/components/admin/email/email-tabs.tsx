"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { CampaignsTab, CampaignRow, ListRow } from "@/components/admin/email/campaigns-tab";
import { SubscribersTab, SubscriberRow } from "@/components/admin/email/subscribers-tab";
import { ListsTab } from "@/components/admin/email/lists-tab";
import { TemplatesTab, TemplateRow } from "@/components/admin/email/templates-tab";
import { TriggeredTab, TriggeredRow } from "@/components/admin/email/triggered-tab";

export interface OutboxRow {
  id: string;
  kind: string;
  channel: string;
  toAddress: string;
  subject: string | null;
  status: string;
  attempts: number;
  providerId: string | null;
  lastError: string | null;
  createdAt: string;
}

const TABS = ["Campaigns", "Subscribers", "Lists", "Templates", "Triggered", "Send log"] as const;
type Tab = (typeof TABS)[number];

const MODE_TONES: Record<string, { tone: "green" | "amber" | "stone"; label: string }> = {
  live: { tone: "green", label: "live (Resend)" },
  fixture: { tone: "amber", label: "fixture (dev double)" },
  capture: { tone: "stone", label: "capture (no key)" },
};

export function EmailTabs({
  mode,
  campaigns,
  lists,
  subscribers,
  templates,
  triggered,
  recentOutbox,
}: {
  mode: { email: "live" | "fixture" | "capture"; sms: "live" | "capture" };
  campaigns: CampaignRow[];
  lists: ListRow[];
  subscribers: SubscriberRow[];
  templates: TemplateRow[];
  triggered: TriggeredRow[];
  recentOutbox: OutboxRow[];
}) {
  const [tab, setTab] = useState<Tab>("Campaigns");
  const emailMode = MODE_TONES[mode.email];

  return (
    <div className="mt-4" data-email-hub>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-stone-600">Delivery:</span>
        <Badge tone={emailMode.tone} data-email-mode>
          email {emailMode.label}
        </Badge>
        <Badge tone={mode.sms === "live" ? "green" : "stone"} data-sms-mode>
          sms {mode.sms === "live" ? "live (Twilio)" : "capture (no key)"}
        </Badge>
      </div>
      <div className="mt-4 flex gap-1 border-b border-stone-200" role="tablist">
        {TABS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={tab === candidate}
            onClick={() => setTab(candidate)}
            className={`rounded-t-md px-3 py-2 text-sm font-medium ${
              tab === candidate ? "bg-brand-700 text-white" : "text-stone-600 hover:bg-stone-100"
            }`}
            data-email-tab={candidate.toLowerCase().replace(" ", "-")}
          >
            {candidate}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === "Campaigns" && <CampaignsTab campaigns={campaigns} lists={lists} />}
        {tab === "Subscribers" && <SubscribersTab subscribers={subscribers} />}
        {tab === "Lists" && <ListsTab lists={lists} subscribers={subscribers} />}
        {tab === "Templates" && <TemplatesTab templates={templates} />}
        {tab === "Triggered" && <TriggeredTab triggered={triggered} templates={templates} />}
        {tab === "Send log" && (
          <div className="max-w-4xl">
            <h2 className="text-lg font-semibold">Recent outbox</h2>
            <p className="mt-1 text-sm text-stone-600">
              The 20 most recent outbox rows — every email/SMS the system sends lands here first and is
              drained by the outbox sweep cron.
            </p>
            <table className="mt-3 w-full text-left text-sm" data-outbox-log>
              <thead>
                <tr className="border-b border-stone-200 text-xs uppercase text-stone-500">
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Kind</th>
                  <th className="py-2 pr-3">Channel</th>
                  <th className="py-2 pr-3">To</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Attempts</th>
                  <th className="py-2">Provider</th>
                </tr>
              </thead>
              <tbody>
                {recentOutbox.map((message) => (
                  <tr key={message.id} className="border-b border-stone-100" data-outbox-row={message.kind}>
                    <td className="py-2 pr-3 text-xs text-stone-500">{new Date(message.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-3 font-medium">{message.kind}</td>
                    <td className="py-2 pr-3">{message.channel}</td>
                    <td className="py-2 pr-3">{message.toAddress}</td>
                    <td className="py-2 pr-3">
                      <Badge
                        tone={
                          message.status === "SENT" ? "green" : message.status === "FAILED" ? "red" : message.status === "SENDING" ? "amber" : "stone"
                        }
                      >
                        {message.status}
                      </Badge>
                      {message.lastError && (
                        <span className="ml-1 text-xs text-red-700" title={message.lastError}>
                          {message.lastError.slice(0, 60)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">{message.attempts}</td>
                    <td className="py-2 text-xs text-stone-500">{message.providerId ?? "—"}</td>
                  </tr>
                ))}
                {recentOutbox.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-3 text-stone-500">
                      Nothing sent yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
