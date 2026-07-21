import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { err, ok, type Result } from "@/lib/result";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MIME_EXTENSIONS: Record<string, Set<string>> = {
  "image/jpeg": new Set([".jpg", ".jpeg"]),
  "image/png": new Set([".png"]),
  "image/webp": new Set([".webp"]),
  "image/gif": new Set([".gif"]),
};
const BLOCKED_EXTENSIONS = new Set([".html", ".htm", ".svg", ".js", ".mjs", ".css", ".xml", ".shtml"]);
const MAX_BYTES = 5 * 1024 * 1024;

// ponytail: local disk stand-in for Vercel Blob; swap to @vercel/blob.put when BLOB_READ_WRITE_TOKEN is set.
const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

export function validateUpload(file: {
  type: string;
  size: number;
  name: string;
}): Result<{ contentType: string; filename: string; ext: string }> {
  if (!ALLOWED_MIME.has(file.type)) {
    return err(
      "type",
      `File type not allowed (${file.type || "unknown"}). Use JPEG, PNG, WebP, or GIF.`,
    );
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return err("size", "Image must be under 5 MB.");
  }
  const rawExt = path.extname(file.name).toLowerCase();
  if (!rawExt || BLOCKED_EXTENSIONS.has(rawExt)) {
    return err("extension", `File extension not allowed (${rawExt || "none"}).`);
  }
  const allowedExts = MIME_EXTENSIONS[file.type];
  if (!allowedExts?.has(rawExt)) {
    return err(
      "extension",
      `Extension ${rawExt} does not match declared type ${file.type}.`,
    );
  }
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || `upload${rawExt}`;
  return ok({ contentType: file.type, filename: safe, ext: rawExt });
}

export async function storeMedia(file: File, altText?: string): Promise<
  Result<{
    id: string;
    url: string;
    pathname: string;
    contentType: string;
    byteSize: number;
  }>
> {
  const checked = validateUpload({ type: file.type, size: file.size, name: file.name });
  if (!checked.ok) return checked;

  const bytes = Buffer.from(await file.arrayBuffer());
  const pathname = `media/${Date.now()}-${randomBytes(4).toString("hex")}${checked.value.ext}`;
  const abs = path.join(UPLOAD_ROOT, pathname);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, bytes);

  const url = `/uploads/${pathname.replace(/\\/g, "/")}`;
  const row = await db.mediaAsset.create({
    data: {
      filename: checked.value.filename,
      contentType: checked.value.contentType,
      byteSize: bytes.length,
      url,
      pathname,
      altText: altText?.trim() || null,
    },
  });

  return ok({
    id: row.id,
    url: row.url,
    pathname: row.pathname,
    contentType: row.contentType,
    byteSize: row.byteSize,
  });
}

export async function linkMediaToProduct(
  productId: string,
  mediaAssetId: string,
): Promise<Result<{ productId: string; mediaAssetId: string; primaryImageUrl: string }>> {
  const media = await db.mediaAsset.findUnique({ where: { id: mediaAssetId } });
  if (!media) return err("missing_media", "Media asset not found.");
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) return err("missing_product", "Product not found.");
  await db.product.update({
    where: { id: productId },
    data: {
      mediaAssetId: media.id,
      primaryImageUrl: media.url,
    },
  });
  return ok({ productId, mediaAssetId: media.id, primaryImageUrl: media.url });
}

export async function listMedia(limit = 50) {
  return db.mediaAsset.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

export async function productsNeedingPhotos() {
  return db.product.findMany({
    where: {
      isActive: true,
      OR: [{ primaryImageUrl: null }, { primaryImageUrl: "" }],
      mediaAssetId: null,
    },
    orderBy: [{ seasonId: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      sku: true,
      seasonId: true,
      season: { select: { name: true, year: true } },
    },
  });
}
