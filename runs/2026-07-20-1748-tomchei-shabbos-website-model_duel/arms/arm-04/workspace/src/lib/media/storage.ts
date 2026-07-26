import 'server-only';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MediaStorage } from '@prisma/client';

import { env } from '../env';

/**
 * Where uploaded bytes go. Vercel Blob is the deployment target (R-180); the
 * local driver exists so the app, its tests and CI can store an image with no
 * network and no blob token, the same split the auth provider already uses.
 *
 * A hosted deployment cannot select the local driver: its filesystem is
 * read-only and per-instance, so a photo saved there would vanish. Env
 * validation enforces that, and this module assumes it.
 */
export type StoredImage = { storage: MediaStorage; pathname: string; url: string };

const LOCAL_UPLOAD_DIRECTORY = 'public/uploads';
const UPLOAD_ROOT = path.resolve(process.cwd(), LOCAL_UPLOAD_DIRECTORY);

export async function storeImage(
  pathname: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<StoredImage> {
  return env.MEDIA_STORAGE === 'blob'
    ? storeInVercelBlob(pathname, bytes, contentType)
    : storeOnDisk(pathname, bytes);
}

async function storeInVercelBlob(
  pathname: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<StoredImage> {
  const { put } = await import('@vercel/blob');

  // `addRandomSuffix: false` keeps the pathname we generated, which is already
  // unique and is the column the database enforces uniqueness on.
  const blob = await put(pathname, Buffer.from(bytes), {
    access: 'public',
    contentType,
    addRandomSuffix: false,
    token: env.BLOB_READ_WRITE_TOKEN,
  });

  return { storage: 'VERCEL_BLOB', pathname: blob.pathname, url: blob.url };
}

async function storeOnDisk(pathname: string, bytes: Uint8Array): Promise<StoredImage> {
  const target = path.resolve(UPLOAD_ROOT, pathname);

  // `buildPathname` strips everything but lowercase letters, digits and dashes,
  // so a pathname cannot climb out of the folder today. This is the second lock:
  // a future caller that builds its own name still cannot write anywhere else.
  if (!target.startsWith(`${UPLOAD_ROOT}${path.sep}`)) {
    throw new Error(`Refusing to store "${pathname}": it resolves outside the upload folder.`);
  }

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);

  return { storage: 'LOCAL', pathname, url: `/uploads/${pathname}` };
}
