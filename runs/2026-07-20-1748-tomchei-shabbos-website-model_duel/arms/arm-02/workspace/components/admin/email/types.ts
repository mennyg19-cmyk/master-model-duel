// Shared shapes for the email hub: single source of truth for the payload the
// server page (app/(admin)/admin/email/page.tsx) builds for the hub client.

export type CampaignRow = {
  id: string;
  name: string;
  subject: string;
  body: string;
  listId: string | null;
  listName: string | null;
  status: "DRAFT" | "SENT";
  queuedCount: number;
  /** ISO string — Date objects can't cross the server/client boundary. */
  sentAt: string | null;
};

export type EmailListRow = { id: string; name: string; memberCount: number };

export type TemplateRow = {
  key: string;
  label: string;
  placeholders: string[];
  subject: string;
  body: string;
  isEnabled: boolean;
};

export type EmailHubData = {
  campaigns: CampaignRow[];
  lists: EmailListRow[];
  subscribedCount: number;
  unsubscribedCount: number;
  templates: TemplateRow[];
  /** Outbox row counts keyed by notification status. */
  outbox: Record<string, number>;
};
