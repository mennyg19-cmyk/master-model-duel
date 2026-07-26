'use server';

import { redirect } from 'next/navigation';

import { trimmedField } from '@/lib/forms/form-data';
import { payLocalHostedSession } from '@/lib/payments/local-hosted';

export async function payHostedSessionAction(formData: FormData): Promise<void> {
  const sessionId = trimmedField(formData, 'sessionId');
  const orderId = trimmedField(formData, 'orderId');

  const paid = await payLocalHostedSession(sessionId);
  const search = new URLSearchParams({ order: orderId });
  if (!paid.ok) search.set('problem', paid.publicMessage);

  redirect(`/order/confirmation?${search.toString()}`);
}
