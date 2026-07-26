'use server';

import { revalidatePath } from 'next/cache';

import { requirePermission } from '@/lib/auth/staff';
import { seasonYearFor } from '@/lib/core/season';
import { uploadImage } from '@/lib/media/library';

export type MediaFormState = { error: string | null; notice: string | null };

export async function uploadImageAction(
  _previous: MediaFormState,
  formData: FormData,
): Promise<MediaFormState> {
  const context = await requirePermission('media.manage');

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose an image to upload.', notice: null };
  }

  const uploaded = await uploadImage(context, {
    file,
    altText: String(formData.get('altText') ?? ''),
    seasonYear: seasonYearFor(new Date()),
  });

  if (!uploaded.ok) return { error: uploaded.publicMessage, notice: null };

  revalidatePath('/admin/media');
  revalidatePath('/admin/catalog');
  return { error: null, notice: `Stored ${uploaded.value.originalFilename}.` };
}
