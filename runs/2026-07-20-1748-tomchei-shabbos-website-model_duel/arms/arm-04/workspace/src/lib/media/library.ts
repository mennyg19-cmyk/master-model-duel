import 'server-only';

import { randomUUID } from 'node:crypto';
import type { MediaAsset, Product } from '@prisma/client';

import { recordAudit } from '../audit';
import type { StaffContext } from '../auth/staff';
import { db } from '../db';
import { failure, ok, type Result } from '../core/result';
import { storeImage } from './storage';
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_REJECTION_MESSAGES,
  buildPathname,
  validateImageUpload,
} from './validation';

export const UPLOAD_REJECTED = 'upload_rejected';

/**
 * Validates first, stores second, records last. Nothing reaches the blob store
 * until the bytes have been checked, so a rejected file is never written
 * anywhere it could be served from.
 */
export async function uploadImage(
  context: StaffContext,
  input: { file: File; altText: string; seasonYear: number },
): Promise<Result<MediaAsset>> {
  if (input.file.size > MAX_UPLOAD_BYTES) {
    return failure(UPLOAD_REJECTED, UPLOAD_REJECTION_MESSAGES.too_large);
  }

  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const validation = validateImageUpload({
    filename: input.file.name,
    declaredContentType: input.file.type,
    bytes,
    altText: input.altText,
  });

  if (!validation.valid) {
    return failure(UPLOAD_REJECTED, UPLOAD_REJECTION_MESSAGES[validation.reason]);
  }

  const pathname = buildPathname({
    originalFilename: input.file.name,
    extension: validation.extension,
    uniqueSuffix: randomUUID().slice(0, 8),
    seasonYear: input.seasonYear,
  });

  const stored = await storeImage(pathname, bytes, validation.contentType);

  const asset = await db.mediaAsset.create({
    data: {
      storage: stored.storage,
      pathname: stored.pathname,
      url: stored.url,
      originalFilename: input.file.name,
      contentType: validation.contentType,
      sizeBytes: bytes.byteLength,
      altText: input.altText.trim(),
      uploadedByStaffUserId: context.actor.id,
    },
  });

  await recordAudit(context, {
    action: 'media.uploaded',
    entityType: 'MediaAsset',
    entityId: asset.id,
    detail: {
      pathname: asset.pathname,
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes,
    },
  });

  return ok(asset);
}

export async function listMediaAssets(limit = 60): Promise<MediaAsset[]> {
  return db.mediaAsset.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
}

/** The needs-photos panel (R-128): live products with nothing to show on a card. */
export async function productsNeedingPhotos(seasonId: string): Promise<Product[]> {
  return db.product.findMany({
    where: { seasonId, isActive: true, imageAssetId: null },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}
