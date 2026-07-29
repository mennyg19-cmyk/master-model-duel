// The email hub's shared display vocabulary (m19/m20/m24): one status→tone
// record for every badge in the hub (campaign, recipient, and outbox rows
// share the same state words), one error-preview truncation length for table
// cells (the full text always rides the title attribute), and one send-log
// page size shared by the page query and the tab prose.

export const STATUS_TONES: Record<string, "stone" | "amber" | "green" | "red"> = {
  DRAFT: "stone",
  PENDING: "stone",
  SENDING: "amber",
  SENT: "green",
  FAILED: "red",
  SKIPPED: "stone",
};

export const ERROR_PREVIEW_CHARS = 50;

export const RECENT_OUTBOX_LIMIT = 20;
