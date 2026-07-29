import { getSetting, SettingValue } from "@/lib/settings";

// R-085: the one template renderer. Templates and overrides are plain text
// with {{token}} placeholders; unknown tokens stay literal so a staff typo is
// visible in the test send instead of vanishing silently.
export type RenderTokens = Record<string, string>;

export function renderTemplate(template: string, tokens: RenderTokens): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => tokens[key] ?? match);
}

export type EmailBranding = SettingValue<"email.branding">;

export async function getEmailBranding(): Promise<EmailBranding> {
  const branding = await getSetting("email.branding");
  if (!branding) {
    // Seeded in prisma/seed.ts; refusing loudly beats sending unbranded mail.
    throw new Error("email.branding is not configured; expected the seeded sender branding");
  }
  return branding;
}

// Branding is applied at enqueue time: the outbox row stores the exact final
// subject/body bytes, so the sweep, the log, and any purge decision all see
// what the recipient would have received.
export function brandTokens(branding: EmailBranding, tokens: RenderTokens): RenderTokens {
  return { brand: branding.fromName, footer: branding.footerText, ...tokens };
}

export function brandedFrom(branding: EmailBranding): string {
  return `${branding.fromName} <${branding.fromEmail}>`;
}
