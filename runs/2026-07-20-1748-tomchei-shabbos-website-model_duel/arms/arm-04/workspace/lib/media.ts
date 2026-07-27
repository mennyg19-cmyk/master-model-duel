import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { put, del } from "@vercel/blob";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Media library storage (R-067, R-128). Production target is Vercel Blob;
 * without BLOB_READ_WRITE_TOKEN (local dev, this harness) bytes land in
 * .uploads/ and are served by /media/[id]. The MediaAsset row records which
 * driver owns the bytes so the two can coexist.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// Restricted uploads (R-128): images only, checked by real file bytes below —
// a renamed .exe fails the signature check no matter what the browser claims.
const IMAGE_SIGNATURES: { contentType: string; extension: string; matches: (bytes: Buffer) => boolean }[] = [
  { contentType: "image/png", extension: "png", matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { contentType: "image/jpeg", extension: "jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { contentType: "image/gif", extension: "gif", matches: (b) => b.subarray(0, 4).toString("latin1") === "GIF8" },
  { contentType: "image/webp", extension: "webp", matches: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];

const LOCAL_UPLOAD_DIR = path.join(process.cwd(), ".uploads");

export type UploadRejection = { ok: false; reason: string };
export type UploadSuccess = { ok: true; asset: { id: string; url: string; filename: string; contentType: string } };

export function detectImageType(bytes: Buffer) {
  return IMAGE_SIGNATURES.find((sig) => sig.matches(bytes)) ?? null;
}

export async function saveMediaUpload(
  file: File,
  uploadedById: string | null
): Promise<UploadSuccess | UploadRejection> {
  if (file.size === 0) return { ok: false, reason: "The file is empty." };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 5 MB.` };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const detected = detectImageType(bytes);
  if (!detected) {
    return { ok: false, reason: "Only PNG, JPEG, GIF, and WebP images are allowed. The file contents are not a recognized image." };
  }

  const safeName = file.name.replace(/[^\w.\-]/g, "_").slice(0, 120) || `upload.${detected.extension}`;

  if (env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`media/${Date.now()}-${safeName}`, bytes, {
      access: "public",
      contentType: detected.contentType,
    });
    const asset = await db.mediaAsset.create({
      data: { filename: safeName, contentType: detected.contentType, sizeBytes: bytes.length, storage: "vercel-blob", url: blob.url, uploadedById },
    });
    return { ok: true, asset };
  }

  const asset = await db.mediaAsset.create({
    data: { filename: safeName, contentType: detected.contentType, sizeBytes: bytes.length, storage: "local", url: "", uploadedById },
  });
  await mkdir(LOCAL_UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(LOCAL_UPLOAD_DIR, asset.id), bytes);
  const withUrl = await db.mediaAsset.update({ where: { id: asset.id }, data: { url: `/media/${asset.id}` } });
  return { ok: true, asset: withUrl };
}

/** Bytes for a locally stored asset, or null when missing on disk. */
export async function readLocalMedia(assetId: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(LOCAL_UPLOAD_DIR, assetId));
  } catch {
    return null;
  }
}

export async function deleteMediaAsset(assetId: string): Promise<void> {
  const asset = await db.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset) return;
  await db.product.updateMany({ where: { imageId: assetId }, data: { imageId: null } });
  await db.mediaAsset.delete({ where: { id: assetId } });
  if (asset.storage === "vercel-blob") {
    await del(asset.url);
  } else {
    await unlink(path.join(LOCAL_UPLOAD_DIR, assetId)).catch(() => undefined);
  }
}
