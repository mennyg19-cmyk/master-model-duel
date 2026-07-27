import 'server-only';

import { readSetting } from '../settings';

/**
 * What every email wears (R-085).
 *
 * The sender identity and the branding are settings rather than environment
 * variables because the office changes them: a new campaign year, a new
 * reply-to address, a logo that finally has a home. They are read when a
 * message is sent rather than when it is queued, so last night's backlog goes
 * out under today's letterhead. Each sweep reads them once for the whole
 * batch — six settings rows per message would be six hundred queries a run —
 * so a change made mid-sweep lands on the next sweep, a minute later.
 */
export type EmailBranding = {
  fromName: string;
  fromAddress: string;
  replyToAddress: string;
  logoUrl: string;
  footerText: string;
  accentColor: string;
};

export async function readEmailBranding(): Promise<EmailBranding> {
  const [fromName, fromAddress, replyToAddress, logoUrl, footerText, accentColor] = await Promise.all([
    readSetting('email.fromName'),
    readSetting('email.fromAddress'),
    readSetting('email.replyToAddress'),
    readSetting('email.logoUrl'),
    readSetting('email.footerText'),
    readSetting('email.accentColor'),
  ]);

  return { fromName, fromAddress, replyToAddress, logoUrl, footerText, accentColor };
}

/**
 * The `From:` line. Null when the office has not set an address yet, which the
 * sender treats as "not configured" rather than mailing from an empty string
 * and having the provider refuse every message in the queue.
 */
export function senderLine(branding: EmailBranding): string | null {
  if (branding.fromAddress.trim() === '') return null;

  const name = branding.fromName.trim();
  return name === '' ? branding.fromAddress.trim() : `${name} <${branding.fromAddress.trim()}>`;
}

/**
 * The plain-text body wrapped in the org's letterhead.
 *
 * Emails are written as plain text everywhere in this app — the outbox row is
 * the text the customer reads — and the HTML is generated from it here. That
 * way there is one body to write, one body to audit, and a client that refuses
 * HTML still gets the whole message.
 */
export function renderBrandedHtml(
  branding: EmailBranding,
  content: { subject: string; body: string },
): string {
  const paragraphs = content.body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .map((block) => `<p style="margin:0 0 16px">${linkify(escapeHtml(block), branding.accentColor).replace(/\n/g, '<br />')}</p>`)
    .join('');

  const footer = branding.footerText.trim();

  return [
    '<!doctype html><html><body style="margin:0;background:#f6f4f1;padding:24px;font-family:Georgia,serif;color:#1f1b16">',
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">',
    logoOrName(branding),
    `<h1 style="margin:0 0 16px;font-size:20px;color:${escapeHtml(branding.accentColor)}">${escapeHtml(content.subject)}</h1>`,
    paragraphs,
    footer === ''
      ? ''
      : `<hr style="margin:24px 0;border:none;border-top:1px solid #e6e1da" /><p style="margin:0;font-size:12px;color:#6b6259">${linkify(escapeHtml(footer), branding.accentColor)}</p>`,
    '</div></body></html>',
  ].join('');
}

/**
 * Payment links, order links and the newsletter's own manage link are written
 * into the body as plain URLs, because the text version is the one this app
 * stores and audits. They have to be clickable in the HTML twin: an
 * unsubscribe link nobody can click is not an unsubscribe link.
 */
function linkify(escapedText: string, accentColor: string): string {
  return escapedText.replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}" style="color:${escapeHtml(accentColor)}">${url}</a>`,
  );
}

function logoOrName(branding: EmailBranding): string {
  if (branding.logoUrl.trim() !== '') {
    return `<img src="${escapeHtml(branding.logoUrl.trim())}" alt="${escapeHtml(branding.fromName)}" style="max-height:48px;margin-bottom:20px" />`;
  }

  if (branding.fromName.trim() === '') return '';
  return `<p style="margin:0 0 20px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b6259">${escapeHtml(branding.fromName)}</p>`;
}

/**
 * Campaign and template bodies are written by staff and greeting messages come
 * from customers, so every value that reaches the markup is escaped. An email
 * client is a browser.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
