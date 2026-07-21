"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Email hub (P11): campaigns, lists, subscribers, triggered templates. Server
// page loads the data; every mutation goes through the /api/admin/email/*
// routes and refreshes. Same act() plumbing as the settings hub.

export type EmailHubData = {
  campaigns: {
    id: string;
    name: string;
    subject: string;
    body: string;
    listId: string | null;
    listName: string | null;
    status: "DRAFT" | "SENT";
    queuedCount: number;
    sentAt: string | null;
  }[];
  lists: { id: string; name: string; memberCount: number }[];
  subscribedCount: number;
  unsubscribedCount: number;
  templates: {
    key: string;
    label: string;
    placeholders: string[];
    subject: string;
    body: string;
    isEnabled: boolean;
  }[];
  outbox: Record<string, number>;
};

const TABS = ["Campaigns", "Lists", "Subscribers", "Templates"] as const;
type Tab = (typeof TABS)[number];

export function EmailHub({ data }: { data: EmailHubData }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Campaigns");
  const [message, setMessage] = useState<string | null>(null);

  async function act(action: () => Promise<{ ok: boolean; error?: string }>, successMessage = "Saved.") {
    setMessage(null);
    const outcome = await action();
    setMessage(outcome.ok ? successMessage : outcome.error ?? "Request failed.");
    if (outcome.ok) router.refresh();
  }

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

      {message && <p className="rounded bg-brand-soft px-3 py-2 text-sm" data-testid="email-hub-message">{message}</p>}

      {tab === "Campaigns" && <CampaignsTab campaigns={data.campaigns} lists={data.lists} outbox={data.outbox} act={act} />}
      {tab === "Lists" && <ListsTab lists={data.lists} act={act} />}
      {tab === "Subscribers" && <SubscribersTab subscribedCount={data.subscribedCount} unsubscribedCount={data.unsubscribedCount} />}
      {tab === "Templates" && <TemplatesTab templates={data.templates} act={act} />}
    </div>
  );
}

type ActFn = (action: () => Promise<{ ok: boolean; error?: string }>, successMessage?: string) => Promise<void>;

function CampaignsTab({
  campaigns,
  lists,
  outbox,
  act,
}: {
  campaigns: EmailHubData["campaigns"];
  lists: EmailHubData["lists"];
  outbox: Record<string, number>;
  act: ActFn;
}) {
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [listId, setListId] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [preview, setPreview] = useState<{ to: string; subject: string; body: string } | null>(null);

  async function loadPreview(campaignId: string) {
    const result = await apiFetch<{ preview: { to: string; subject: string; body: string } }>(
      `/api/admin/email/campaigns/${campaignId}`
    );
    setPreview(result.ok ? result.body.preview : null);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>New campaign</CardTitle>
        <div className="space-y-2 text-sm">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Internal name" className="block w-full max-w-md" />
          <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject — {{name}} and {{orgName}} work here" className="block w-full max-w-xl" />
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Body. Placeholders: {{name}}, {{email}}, {{orgName}}, {{preferencesUrl}}. An unsubscribe link is appended when the body has none."
            rows={5}
            className="block w-full max-w-2xl rounded-md border border-border bg-background px-3 py-2"
          />
          <select value={listId} onChange={(event) => setListId(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5">
            <option value="">All subscribed addresses</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name} ({list.memberCount})
              </option>
            ))}
          </select>
          <div>
            <Button
              onClick={() =>
                act(
                  () => apiFetch("/api/admin/email/campaigns", { body: { name, subject, body, listId: listId || null } }),
                  "Campaign drafted."
                )
              }
            >
              Create draft
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Campaigns</CardTitle>
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="text-muted">Test-send address:</span>
          <Input value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="you@example.com" className="w-64" />
        </div>
        {campaigns.length === 0 && <p className="text-sm text-muted">No campaigns yet.</p>}
        <ul className="space-y-3">
          {campaigns.map((campaign) => (
            <li key={campaign.id} className="rounded-md border border-border p-3 text-sm" data-testid={`campaign-${campaign.id}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-medium">{campaign.name}</span>{" "}
                  <Badge tone={campaign.status === "SENT" ? "brand" : "neutral"}>{campaign.status}</Badge>
                  <p className="text-muted">
                    “{campaign.subject}” → {campaign.listName ?? "all subscribers"}
                    {campaign.status === "SENT" && ` · ${campaign.queuedCount} queued`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" onClick={() => loadPreview(campaign.id)}>
                    Preview
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!testEmail}
                    onClick={() =>
                      act(
                        () => apiFetch(`/api/admin/email/campaigns/${campaign.id}/test-send`, { body: { email: testEmail } }),
                        `Test sent to ${testEmail}.`
                      )
                    }
                  >
                    Test send
                  </Button>
                  <Button
                    onClick={() =>
                      act(() => apiFetch(`/api/admin/email/campaigns/${campaign.id}/send`, { body: {} }), "Campaign queued to the outbox.")
                    }
                  >
                    {campaign.status === "SENT" ? "Re-run send" : "Send"}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {preview && (
          <div className="mt-4 rounded-md border border-border bg-background p-3 text-sm" data-testid="campaign-preview">
            <p className="text-xs text-muted">Preview as {preview.to}</p>
            <p className="mt-1 font-medium">{preview.subject}</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{preview.body}</pre>
          </div>
        )}
        <p className="mt-4 text-xs text-muted">
          Outbox: {Object.entries(outbox).map(([status, count]) => `${status} ${count}`).join(" · ") || "empty"}. The sweeper cron
          delivers queued mail; a re-run send never duplicates a delivery.
        </p>
      </Card>
    </div>
  );
}

function ListsTab({ lists, act }: { lists: EmailHubData["lists"]; act: ActFn }) {
  const [name, setName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");

  return (
    <Card>
      <CardTitle>Lists</CardTitle>
      <div className="mb-4 flex gap-2 text-sm">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="New list name" className="w-64" />
        <Button onClick={() => act(() => apiFetch("/api/admin/email/lists", { body: { name } }), "List created.")}>Create list</Button>
      </div>
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-muted">Member email:</span>
        <Input value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="subscriber@example.com" className="w-64" />
      </div>
      {lists.length === 0 && <p className="text-sm text-muted">No lists yet — campaigns without a list go to every subscriber.</p>}
      <ul className="space-y-2 text-sm">
        {lists.map((list) => (
          <li key={list.id} className="flex items-center justify-between rounded-md border border-border p-3">
            <span>
              <span className="font-medium">{list.name}</span> <span className="text-muted">· {list.memberCount} members</span>
            </span>
            <span className="flex gap-2">
              <Button
                variant="secondary"
                disabled={!memberEmail}
                onClick={() =>
                  act(
                    () => apiFetch(`/api/admin/email/lists/${list.id}/members`, { body: { email: memberEmail, action: "add" } }),
                    "Member added."
                  )
                }
              >
                Add member
              </Button>
              <Button
                variant="secondary"
                disabled={!memberEmail}
                onClick={() =>
                  act(
                    () => apiFetch(`/api/admin/email/lists/${list.id}/members`, { body: { email: memberEmail, action: "remove" } }),
                    "Member removed."
                  )
                }
              >
                Remove
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SubscribersTab({ subscribedCount, unsubscribedCount }: { subscribedCount: number; unsubscribedCount: number }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<
    { id: string; email: string; name: string | null; status: string; wantsSeasonOpening: boolean; wantsPurimReminders: boolean; listMemberships: { list: { name: string } }[] }[]
  >([]);
  const [searched, setSearched] = useState(false);

  async function search() {
    const result = await apiFetch<{ subscribers: typeof rows }>(`/api/admin/email/subscribers?q=${encodeURIComponent(query)}`);
    setRows(result.ok ? result.body.subscribers : []);
    setSearched(true);
  }

  return (
    <Card>
      <CardTitle>Subscribers</CardTitle>
      <p className="mb-3 text-sm text-muted">
        {subscribedCount} subscribed · {unsubscribedCount} unsubscribed. Preference and unsubscribe changes happen through each
        subscriber&apos;s signed email link — staff can look up, not impersonate.
      </p>
      <div className="mb-3 flex gap-2 text-sm">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by email" className="w-64" />
        <Button variant="secondary" onClick={search}>
          Search
        </Button>
      </div>
      {searched && rows.length === 0 && <p className="text-sm text-muted">No matches.</p>}
      <ul className="space-y-1 text-sm">
        {rows.map((subscriber) => (
          <li key={subscriber.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span>
              {subscriber.email}
              {subscriber.name ? ` (${subscriber.name})` : ""}
              {subscriber.listMemberships.length > 0 && (
                <span className="text-muted"> · {subscriber.listMemberships.map((member) => member.list.name).join(", ")}</span>
              )}
            </span>
            <span className="flex gap-1">
              <Badge tone={subscriber.status === "SUBSCRIBED" ? "brand" : "neutral"}>{subscriber.status}</Badge>
              {subscriber.status === "SUBSCRIBED" && (
                <span className="text-xs text-muted">
                  {subscriber.wantsSeasonOpening ? "openings" : ""} {subscriber.wantsPurimReminders ? "reminders" : ""}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TemplatesTab({ templates, act }: { templates: EmailHubData["templates"]; act: ActFn }) {
  const [drafts, setDrafts] = useState<Record<string, { subject: string; body: string }>>(
    Object.fromEntries(templates.map((template) => [template.key, { subject: template.subject, body: template.body }]))
  );

  return (
    <div className="space-y-4">
      {templates.map((template) => (
        <Card key={template.key} data-testid={`template-${template.key}`}>
          <CardTitle className="flex items-center justify-between">
            <span>{template.label}</span>
            <Badge tone={template.isEnabled ? "brand" : "neutral"}>{template.isEnabled ? "Enabled" : "Disabled"}</Badge>
          </CardTitle>
          <p className="mb-2 text-xs text-muted">Placeholders: {template.placeholders.map((name) => `{{${name}}}`).join(", ")}</p>
          <div className="space-y-2 text-sm">
            <Input
              value={drafts[template.key].subject}
              onChange={(event) => setDrafts({ ...drafts, [template.key]: { ...drafts[template.key], subject: event.target.value } })}
              className="block w-full max-w-xl"
            />
            <textarea
              value={drafts[template.key].body}
              onChange={(event) => setDrafts({ ...drafts, [template.key]: { ...drafts[template.key], body: event.target.value } })}
              rows={4}
              className="block w-full max-w-2xl rounded-md border border-border bg-background px-3 py-2"
            />
            <div className="flex gap-2">
              <Button
                onClick={() =>
                  act(
                    () =>
                      apiFetch("/api/admin/email/templates", {
                        method: "PATCH",
                        body: { key: template.key, subject: drafts[template.key].subject, body: drafts[template.key].body },
                      }),
                    "Template override saved."
                  )
                }
              >
                Save override
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  act(
                    () => apiFetch("/api/admin/email/templates", { method: "PATCH", body: { key: template.key, subject: null, body: null } }),
                    "Reset to default."
                  )
                }
              >
                Reset to default
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  act(
                    () =>
                      apiFetch("/api/admin/email/templates", {
                        method: "PATCH",
                        body: { key: template.key, isEnabled: !template.isEnabled },
                      }),
                    template.isEnabled ? "Template disabled." : "Template enabled."
                  )
                }
              >
                {template.isEnabled ? "Disable" : "Enable"}
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
