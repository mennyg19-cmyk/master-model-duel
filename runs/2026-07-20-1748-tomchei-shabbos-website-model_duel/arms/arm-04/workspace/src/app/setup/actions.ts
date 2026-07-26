'use server';

import { redirect } from 'next/navigation';

import { bootstrapFirstManager, isSetupLocked } from '@/lib/bootstrap';
import { localExternalId, startLocalSession } from '@/lib/auth/local-session';
import { normalizeEmail } from '@/lib/core/normalize';
import { env } from '@/lib/env';

export type SetupFormState = { error: string | null };

export async function createFirstManager(
  _previous: SetupFormState,
  formData: FormData,
): Promise<SetupFormState> {
  if (await isSetupLocked()) {
    return { error: 'Setup has already been completed on this database.' };
  }

  const email = normalizeEmail(String(formData.get('email') ?? ''));
  const fullName = String(formData.get('fullName') ?? '');
  const externalAuthId = env.AUTH_PROVIDER === 'local' ? localExternalId(email) : null;

  const bootstrapped = await bootstrapFirstManager({ email, fullName, externalAuthId });
  if (!bootstrapped.ok) return { error: bootstrapped.publicMessage };

  if (env.AUTH_PROVIDER === 'local') {
    await startLocalSession({ externalId: localExternalId(email), email, fullName });
  }

  redirect('/admin');
}
