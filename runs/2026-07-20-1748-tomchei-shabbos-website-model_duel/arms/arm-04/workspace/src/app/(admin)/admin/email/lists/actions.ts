'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { recordAudit } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/staff';
import { db } from '@/lib/db';
import { addToList, createSubscriberList, removeFromList } from '@/lib/email/subscriber-lists';
import { rejectWith } from '@/lib/forms/flash-redirect';

const LISTS_PATH = '/admin/email/lists';

export async function createListAction(formData: FormData) {
  const context = await requirePermission('email.manage');

  const created = await createSubscriberList({
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? ''),
  });
  if (!created.ok) rejectWith(LISTS_PATH, created.publicMessage);

  await recordAudit(context, {
    action: 'email.list_changed',
    entityType: 'SubscriberList',
    entityId: created.value.id,
    detail: { slug: created.value.slug, change: 'created' },
  });

  revalidatePath(LISTS_PATH);
  redirect(`${LISTS_PATH}?notice=${encodeURIComponent(`${created.value.name} is ready.`)}`);
}

export async function addToListAction(formData: FormData) {
  const context = await requirePermission('email.manage');
  const listId = String(formData.get('listId') ?? '');
  const email = String(formData.get('email') ?? '');

  const added = await addToList(listId, email);
  if (!added.ok) rejectWith(LISTS_PATH, added.publicMessage);

  if (added.value.added) {
    await recordAudit(context, {
      action: 'email.list_changed',
      entityType: 'SubscriberList',
      entityId: listId,
      detail: { slug: await slugOf(listId), change: 'joined' },
    });
  }

  revalidatePath(LISTS_PATH);
  redirect(
    `${LISTS_PATH}?notice=${encodeURIComponent(
      added.value.added ? `${email.trim()} was added.` : `${email.trim()} was already on that list.`,
    )}`,
  );
}

export async function removeFromListAction(formData: FormData) {
  const context = await requirePermission('email.manage');
  const listId = String(formData.get('listId') ?? '');
  const subscriberId = String(formData.get('subscriberId') ?? '');

  await removeFromList(listId, subscriberId);
  await recordAudit(context, {
    action: 'email.list_changed',
    entityType: 'SubscriberList',
    entityId: listId,
    detail: { slug: await slugOf(listId), change: 'left' },
  });

  revalidatePath(LISTS_PATH);
  redirect(`${LISTS_PATH}?notice=${encodeURIComponent('Taken off the list.')}`);
}

async function slugOf(listId: string): Promise<string> {
  const list = await db.subscriberList.findUnique({ where: { id: listId }, select: { slug: true } });
  return list?.slug ?? 'unknown';
}
