"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Tab = "campaigns" | "subscribers" | "lists" | "templates" | "triggered";

export function EmailHub() {
  const [tab, setTab] = useState<Tab>("campaigns");
  const [message, setMessage] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<unknown[]>([]);
  const [subscribers, setSubscribers] = useState<unknown[]>([]);
  const [lists, setLists] = useState<unknown[]>([]);
  const [templates, setTemplates] = useState<unknown[]>([]);
  const [triggered, setTriggered] = useState<unknown[]>([]);
  const [name, setName] = useState("Spring update");
  const [subject, setSubject] = useState("Season is open");
  const [htmlBody, setHtmlBody] = useState("<p>Hello from Tomchei.</p>");
  const [testTo, setTestTo] = useState("manager@tomchei.local");
  const [listName, setListName] = useState("Active list");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string; htmlBody: string } | null>(null);

  const load = useCallback(async (nextTab: Tab = tab) => {
    const res = await fetch(`/api/admin/email?tab=${nextTab}`);
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "Load failed");
      return;
    }
    if (nextTab === "campaigns") setCampaigns(json.campaigns || []);
    if (nextTab === "subscribers") setSubscribers(json.subscribers || []);
    if (nextTab === "lists") setLists(json.lists || []);
    if (nextTab === "templates") setTemplates(json.templates || []);
    if (nextTab === "triggered") setTriggered(json.triggered || []);
  }, [tab]);

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  async function post(body: Record<string, unknown>) {
    setMessage(null);
    const res = await fetch("/api/admin/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setMessage(res.ok ? "OK" : json.error || "Failed");
    return { ok: res.ok, json };
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "campaigns", label: "Campaigns" },
    { id: "subscribers", label: "Subscribers" },
    { id: "lists", label: "Lists" },
    { id: "templates", label: "Templates" },
    { id: "triggered", label: "Triggered" },
  ];

  return (
    <div className="space-y-4" data-testid="email-hub">
      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              tab === t.id ? "bg-[var(--color-leaf)] text-white" : "bg-white"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {message ? <p className="text-sm" data-testid="email-hub-message">{message}</p> : null}

      {tab === "campaigns" ? (
        <section className="space-y-3 rounded bg-white p-4 shadow-sm text-sm">
          <h2 className="font-semibold">Campaign builder</h2>
          <label className="block font-semibold">
            Name
            <input
              className="mt-1 w-full rounded border px-2 py-1.5 font-normal"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="campaign-name"
            />
          </label>
          <label className="block font-semibold">
            Subject
            <input
              className="mt-1 w-full rounded border px-2 py-1.5 font-normal"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              data-testid="campaign-subject"
            />
          </label>
          <label className="block font-semibold">
            HTML body
            <textarea
              className="mt-1 w-full rounded border px-2 py-1.5 font-mono text-xs font-normal"
              rows={4}
              value={htmlBody}
              onChange={(e) => setHtmlBody(e.target.value)}
              data-testid="campaign-body"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              data-testid="campaign-create"
              onClick={async () => {
                const result = await post({
                  action: "create_campaign",
                  name,
                  subject,
                  htmlBody,
                });
                if (result.ok) {
                  setSelectedCampaignId(result.json.campaign?.id ?? null);
                  await load("campaigns");
                }
              }}
            >
              Save draft
            </Button>
            <Button
              type="button"
              data-testid="campaign-preview"
              onClick={async () => {
                if (!selectedCampaignId) return;
                const result = await post({
                  action: "preview_campaign",
                  campaignId: selectedCampaignId,
                });
                if (result.ok) setPreview(result.json.preview);
              }}
            >
              Preview
            </Button>
            <Button
              type="button"
              data-testid="campaign-test-send"
              onClick={async () => {
                if (!selectedCampaignId) return;
                await post({
                  action: "test_send_campaign",
                  campaignId: selectedCampaignId,
                  to: testTo,
                });
              }}
            >
              Test send
            </Button>
            <Button
              type="button"
              data-testid="campaign-send"
              onClick={async () => {
                if (!selectedCampaignId) return;
                await post({ action: "send_campaign", campaignId: selectedCampaignId });
                await load("campaigns");
              }}
            >
              Send
            </Button>
          </div>
          <label className="block font-semibold">
            Test recipient
            <input
              className="mt-1 w-full rounded border px-2 py-1.5 font-normal"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              data-testid="campaign-test-to"
            />
          </label>
          {preview ? (
            <div className="rounded border p-3" data-testid="campaign-preview-pane">
              <p className="font-semibold">{preview.subject}</p>
              <div dangerouslySetInnerHTML={{ __html: preview.htmlBody }} />
            </div>
          ) : null}
          <ul className="divide-y" data-testid="campaign-list">
            {(campaigns as { id: string; name: string; status: string; subject: string }[]).map(
              (c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setSelectedCampaignId(c.id)}
                  >
                    {c.name} · {c.status}
                  </button>
                  <span className="text-xs opacity-70">{c.subject}</span>
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}

      {tab === "subscribers" ? (
        <section className="rounded bg-white p-4 shadow-sm text-sm" data-testid="subscribers-tab">
          <h2 className="mb-2 font-semibold">Subscribers</h2>
          <ul className="divide-y">
            {(subscribers as { id: string; email: string; unsubscribedAt: string | null }[]).map(
              (s) => (
                <li key={s.id} className="py-2">
                  {s.email} {s.unsubscribedAt ? "(unsubscribed)" : ""}
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}

      {tab === "lists" ? (
        <section className="space-y-3 rounded bg-white p-4 shadow-sm text-sm" data-testid="lists-tab">
          <h2 className="font-semibold">Mailing lists</h2>
          <label className="block font-semibold">
            New list
            <input
              className="mt-1 w-full rounded border px-2 py-1.5 font-normal"
              value={listName}
              onChange={(e) => setListName(e.target.value)}
            />
          </label>
          <Button
            type="button"
            onClick={async () => {
              await post({ action: "create_list", name: listName });
              await load("lists");
            }}
          >
            Create list
          </Button>
          <ul className="divide-y">
            {(lists as { id: string; name: string; _count: { members: number } }[]).map((l) => (
              <li key={l.id} className="py-2">
                {l.name} · {l._count.members} members
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "templates" ? (
        <section className="rounded bg-white p-4 shadow-sm text-sm" data-testid="templates-tab">
          <h2 className="mb-2 font-semibold">Templates + branding</h2>
          <ul className="divide-y">
            {(templates as { id: string; key: string; name: string; subject: string }[]).map(
              (t) => (
                <li key={t.id} className="py-2">
                  <span className="font-semibold">{t.key}</span> — {t.name} / {t.subject}
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}

      {tab === "triggered" ? (
        <section className="rounded bg-white p-4 shadow-sm text-sm" data-testid="triggered-tab">
          <h2 className="mb-2 font-semibold">Triggered keys</h2>
          <ul className="divide-y">
            {(
              triggered as {
                key: string;
                defaults: { subject: string };
                override: { enabled: boolean } | null;
              }[]
            ).map((t) => (
              <li key={t.key} className="py-2">
                <span className="font-semibold">{t.key}</span> — {t.defaults.subject}
                {t.override ? ` (override enabled=${t.override.enabled})` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
