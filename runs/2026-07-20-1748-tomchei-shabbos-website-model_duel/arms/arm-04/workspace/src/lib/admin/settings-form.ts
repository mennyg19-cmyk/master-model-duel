import 'server-only';

import { z } from 'zod';

import { recordAudit } from '../audit';
import type { StaffContext } from '../auth/staff';

/**
 * The three things every settings form does the same way (R-161).
 *
 * The settings screens are plain forms with no client state: each one parses
 * the whole form with a named schema, hands the first complaint back through
 * the URL, and leaves an audit row naming the key that changed. Those first two
 * are here because the settings actions are now split across more than one
 * file, and two copies of "how a settings form reports itself" is how the pages
 * start disagreeing about what a saved setting looks like.
 */

/** Numbers arrive from a form as text, so they are read as text and then converted. */
export const wholeNumber = (message: string) =>
  z.string().trim().regex(/^\d+$/, message).transform(Number);

export function firstMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0].message;
}

export async function auditSettingChange(context: StaffContext, key: string, summary: string) {
  await recordAudit(context, {
    action: 'settings.changed',
    entityType: 'Setting',
    entityId: key,
    detail: { key, summary },
  });
}
