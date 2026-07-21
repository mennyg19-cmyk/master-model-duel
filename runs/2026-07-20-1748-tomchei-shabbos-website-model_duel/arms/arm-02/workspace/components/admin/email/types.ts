// Shared shapes for the email hub and its tab components.

export type CampaignRow = {
  id: string;
  name: string;
  subject: string;
  body: string;
  listId: string | null;
  listName: string | null;
  status: "DRAFT" | "SENT";
  sentAt: string | null;
  queuedCount: number;
};

export type EmailListRow = { id: string; name: string; memberCount: number };

export type SubscriberRow = {
  id: string;
  email: string;
  name: string | null;
  status: "SUBSCRIBED" | "UNSUBSCRIBED";
  wantsSeasonOpening: boolean;
  wantsPurimReminders: boolean;
  listNames: string[];
};

export type TemplateRow = {
  key: string;
  label: string;
  placeholders: readonly string[];
  subject: string;
  body: string;
  isEnabled: boolean;
  hasOverride: boolean;
};

export type OutboxCounts = { pending: number; sent: number; captured: number; failed: number };

export type EmailHubData = {
  campaigns: CampaignRow[];
  lists: EmailListRow[];
  subscribers: SubscriberRow[];
  subscriberCounts: { subscribed: number; unsubscribed: number };
  templates: TemplateRow[];
  outboxCounts: OutboxCounts;
};

/** Runs a mutation, surfaces the outcome message, and refreshes on success. */
export type ActFn = (action: () => Promise<{ ok: boolean; error?: string }>, successMessage?: string) => Promise<void>;
