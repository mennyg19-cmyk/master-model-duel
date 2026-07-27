import 'server-only';

import { recordAudit } from '../audit';
import type { StaffContext } from '../auth/staff';
import { readSetting, writeSetting } from '../settings';

/**
 * "This is a rehearsal" (R-101, R-129).
 *
 * The organisation's dress rehearsal happens on the real hosting, against the
 * real database, in the fortnight before the season opens — because a rehearsal
 * on a laptop proves nothing about the hosting. That makes one question urgent:
 * is the order I am looking at real?
 *
 * Test mode answers it in the only way that survives a busy evening: a band
 * across the top of every screen, admin and storefront alike, that cannot be
 * dismissed. It is also the switch the destructive test console reads, so the
 * buttons that wipe orders are only live while the whole deployment is telling
 * everybody it is not real yet.
 *
 * It is a setting rather than an environment flag on purpose. Rehearsing is a
 * decision the manager makes and undoes; a redeploy to change it is a decision
 * they cannot make at eight in the evening.
 */
export function isTestMode(): Promise<boolean> {
  return readSetting('platform.testMode');
}

export async function setTestMode(staff: StaffContext, on: boolean): Promise<void> {
  await writeSetting('platform.testMode', on);

  await recordAudit(staff, {
    action: 'settings.test_mode_changed',
    entityType: 'Setting',
    entityId: 'platform.testMode',
    detail: { on },
  });
}
