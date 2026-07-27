'use server';

import { requirePermission } from '@/lib/auth/staff';
import { redirectWithFlash } from '@/lib/forms/flash-redirect';
import { reconcilePayments } from '@/lib/payments/reconciliation';

const PAYMENTS_PATH = '/admin/reports/payments';

/**
 * The same sweep the nightly cron runs, started by a person (R-093). Reading
 * only: it writes flags, never payments. Nothing here touches money — a
 * discrepancy is somebody's decision, not a correction to apply automatically.
 */
export async function reconcilePaymentsAction(): Promise<void> {
  const staff = await requirePermission('reports.view');

  const summary = await reconcilePayments({ source: 'manual', staffUserId: staff.acting.id });

  redirectWithFlash(PAYMENTS_PATH, {
    notice: `Checked ${summary.checkedCount}. ${summary.flaggedCount} need looking at (${summary.newFlagCount} new), ${summary.resolvedCount} closed.`,
  });
}
