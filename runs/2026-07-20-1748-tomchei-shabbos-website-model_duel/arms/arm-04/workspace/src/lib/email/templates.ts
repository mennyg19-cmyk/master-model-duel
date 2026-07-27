import 'server-only';

import type { DbClient } from '../core/db-client';
import { db } from '../db';

/**
 * The triggered emails and the words they ship with (R-086, R-089, R-178).
 *
 * Every message the app sends on its own has a key here, with wording that
 * works on an empty database — a fresh install mails complete confirmations
 * before anybody opens the settings screen. The office overrides a key by
 * saving an `EmailTemplate` row, which replaces the subject and the body for
 * that one message and nothing else.
 *
 * Placeholders are `{{name}}` and are listed per key, so the editor can show
 * what may be typed and a saved template can be checked before it is used
 * rather than mailing `{{orderLabel}}` to a donor.
 */
export const TRIGGERED_TEMPLATES = {
  'order.confirmation': {
    name: 'Order confirmation',
    description: 'Sent when an order is placed, whether online or at the counter.',
    variables: ['customerName', 'orderLabel', 'total', 'packageCount', 'orderUrl'],
    subject: 'We have your order, {{customerName}}',
    body:
      'Thank you, {{customerName}}.\n\n' +
      'We have {{orderLabel}} for {{total}}, making up {{packageCount}}.\n\n' +
      'You can look at it any time here: {{orderUrl}}\n\n' +
      'Every box you send feeds a family this Purim. Thank you for giving.',
  },
  'order.payment_link': {
    name: 'Payment link',
    description: 'Sent when a payment page is opened for an order that still owes money.',
    variables: ['customerName', 'orderLabel', 'amountDue', 'paymentUrl'],
    subject: 'Finish paying for {{orderLabel}}',
    body:
      'Hello {{customerName}},\n\n' +
      '{{orderLabel}} is waiting on {{amountDue}}. You can pay for it here:\n\n' +
      '{{paymentUrl}}\n\n' +
      'The link stays good until the order is paid. Ring the office if anything looks wrong.',
  },
  'order.refund': {
    name: 'Refund notice',
    description: 'Sent when money goes back to a customer, by card or at the counter.',
    variables: ['customerName', 'orderLabel', 'amountRefunded', 'reason'],
    subject: 'A refund on {{orderLabel}}',
    body:
      'Hello {{customerName}},\n\n' +
      'We have returned {{amountRefunded}} on {{orderLabel}}. Reason given: {{reason}}.\n\n' +
      'A card refund can take a few days to appear on a statement. Cash and cheques are returned ' +
      'at the office.',
  },
} as const;

export type TriggeredTemplateKey = keyof typeof TRIGGERED_TEMPLATES;

export const TRIGGERED_TEMPLATE_KEYS = Object.keys(TRIGGERED_TEMPLATES) as TriggeredTemplateKey[];

export function isTriggeredTemplateKey(value: string): value is TriggeredTemplateKey {
  return value in TRIGGERED_TEMPLATES;
}

export type RenderedTemplate = { subject: string; body: string };

/**
 * The wording in force for one key: the office's override if there is one,
 * otherwise what ships in this file. `null` means the org has switched the
 * message off, and the caller queues nothing.
 */
export async function renderTriggeredEmail(
  key: TriggeredTemplateKey,
  variables: Record<string, string>,
  client: DbClient = db,
): Promise<RenderedTemplate | null> {
  const override = await client.emailTemplate.findUnique({ where: { key } });
  if (override && !override.isEnabled) return null;

  const template = override ?? TRIGGERED_TEMPLATES[key];

  return {
    subject: fillPlaceholders(template.subject, variables),
    body: fillPlaceholders(template.body, variables),
  };
}

/**
 * An unknown placeholder is left standing rather than blanked, so a typo in a
 * saved template shows up as `{{ordreLabel}}` in the preview instead of a hole
 * in the sentence nobody notices until a customer asks what the email meant.
 */
export function fillPlaceholders(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => variables[name] ?? whole);
}

/** The placeholders a saved template uses that its key does not offer. */
export function unknownPlaceholders(key: TriggeredTemplateKey, text: string): string[] {
  const allowed = new Set<string>(TRIGGERED_TEMPLATES[key].variables);
  const used = [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);

  return [...new Set(used.filter((name) => !allowed.has(name)))];
}

/** Sample values, so a preview reads like an email rather than like a form. */
export const TEMPLATE_PREVIEW_VALUES: Record<string, string> = {
  customerName: 'Rivka Stern',
  orderLabel: 'order #218',
  total: '$180.00',
  amountDue: '$180.00',
  amountRefunded: '$36.00',
  packageCount: '3 boxes',
  reason: 'a box we could not fill',
  orderUrl: 'https://example.org/account/orders/218',
  paymentUrl: 'https://example.org/checkout/218',
};
