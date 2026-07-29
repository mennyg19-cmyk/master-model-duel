"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface CampaignRow {
  id: string;
  name: string;
  subject: string;
  status: "DRAFT" | "SENDING" | "SENT" | "FAILED";
  listName: string;
  recipientCount: number;
  sentAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface ListRow {
  id: string;
  name: string;
  description: string | null;
  members: { subscriberId: string; email: string; name: string | null; unsubscribed: boolean }[];
}

const STATUS_TONES: Record<CampaignRow["status"], "stone" | "amber" | "green" | "red"> = {
  DRAFT: "stone",
  SENDING: "amber",
  SENT: "green",
  FAILED: "red",
};

export function CampaignsTab({ campaigns, lists }: { campaigns: CampaignRow[]; lists: ListRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createCampaign(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiFetch("/api/admin/email/campaigns", {
      method: "POST",
      body: { name, subject, bodyText, listId },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.body.error ?? "Could not create the campaign");
      return;
    }
    setName("");
    setSubject("");
    setBodyText("");
    router.refresh();
  }

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-[1fr_360px]" data-campaigns-tab>
      <Card className="p-5">
        <CardTitle>Campaigns</CardTitle>
        <table className="mt-3 w-full text-left text-sm" data-campaign-list>
          <thead>
            <tr className="border-b border-stone-200 text-xs uppercase text-stone-500">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">List</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Recipients</th>
              <th className="py-2">Sent</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.id} className="border-b border-stone-100" data-campaign-row={campaign.name}>
                <td className="py-2 pr-3">
                  <Link href={`/admin/email/campaigns/${campaign.id}`} className="font-medium text-brand-800 hover:underline" data-campaign-open={campaign.id}>
                    {campaign.name}
                  </Link>
                  {campaign.lastError && <p className="text-xs text-red-700">{campaign.lastError}</p>}
                </td>
                <td className="py-2 pr-3">{campaign.listName}</td>
                <td className="py-2 pr-3">
                  <Badge tone={STATUS_TONES[campaign.status]}>{campaign.status}</Badge>
                </td>
                <td className="py-2 pr-3">{campaign.recipientCount}</td>
                <td className="py-2 text-xs text-stone-500">{campaign.sentAt ? new Date(campaign.sentAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-stone-500">
                  No campaigns yet — build the first one on the right.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card className="p-5">
        <CardTitle>New campaign</CardTitle>
        <form className="mt-3 flex flex-col gap-3" onSubmit={createCampaign} data-campaign-create-form>
          <div>
            <Label htmlFor="campaign-name">Name</Label>
            <Input id="campaign-name" value={name} onChange={(event) => setName(event.target.value)} required data-campaign-name />
          </div>
          <div>
            <Label htmlFor="campaign-subject">Subject</Label>
            <Input id="campaign-subject" value={subject} onChange={(event) => setSubject(event.target.value)} required data-campaign-subject />
          </div>
          <div>
            <Label htmlFor="campaign-body">Body (plain text, {"{{brand}}/{{customerName}}/{{footer}}"} allowed)</Label>
            <textarea
              id="campaign-body"
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
              rows={6}
              value={bodyText}
              onChange={(event) => setBodyText(event.target.value)}
              required
              data-campaign-body
            />
          </div>
          <div>
            <Label htmlFor="campaign-list">Send to list</Label>
            <select
              id="campaign-list"
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
              value={listId}
              onChange={(event) => setListId(event.target.value)}
              data-campaign-list-select
            >
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name} ({list.members.length})
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <Button type="submit" disabled={busy || !listId} data-campaign-create>
            {busy ? "Creating…" : "Create draft"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
