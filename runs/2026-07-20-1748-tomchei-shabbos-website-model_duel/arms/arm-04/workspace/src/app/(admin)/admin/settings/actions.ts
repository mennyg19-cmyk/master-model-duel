'use server';

import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/staff';
import { writeSetting } from '@/lib/settings';

export async function setStoreOpenAction(formData: FormData) {
  const context = await requirePermission('settings.manage');
  const isOpen = formData.get('open') === 'true';

  await writeSetting('store.open', isOpen);
  await recordAudit(context, {
    action: 'settings.store_open_changed',
    entityType: 'Setting',
    entityId: 'store.open',
    detail: { open: isOpen },
  });

  revalidatePath('/admin/settings');
  revalidatePath('/');
}
