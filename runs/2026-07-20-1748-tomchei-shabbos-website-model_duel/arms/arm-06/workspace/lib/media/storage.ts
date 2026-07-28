// Media storage seam (R-180). Production driver is Vercel Blob, loaded lazily
// and only when BLOB_READ_WRITE_TOKEN is set — the same lazy-singleton
// discipline as the Stripe seam (R-170). Local dev/smoke writes to .uploads/
// and serves bytes through /uploads/<storedName>.
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

export interface StoredObject {
  url: string;
  storedName: string;
  driver: "vercel-blob" | "local";
}

export const UPLOADS_DIR = path.join(process.cwd(), ".uploads");

export function isBlobDriver(): boolean {
  return Boolean(env.BLOB_READ_WRITE_TOKEN);
}

export async function putObject(input: {
  storedName: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<StoredObject> {
  if (isBlobDriver()) {
    const { put } = await import("@vercel/blob");
    // Fresh copy: BlobPart requires a Uint8Array backed by ArrayBuffer, not
    // the ArrayBufferLike that file.bytes / fetch bodies hand us.
    const bytes = new Uint8Array(input.bytes);
    const blob = await put(input.storedName, new Blob([bytes], { type: input.contentType }), {
      access: "public",
      token: env.BLOB_READ_WRITE_TOKEN,
    });
    return { url: blob.url, storedName: blob.pathname, driver: "vercel-blob" };
  }

  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(path.join(UPLOADS_DIR, input.storedName), input.bytes);
  return { url: `/uploads/${input.storedName}`, storedName: input.storedName, driver: "local" };
}

export async function deleteObject(storedName: string, driver: string): Promise<void> {
  if (driver === "vercel-blob") {
    const { del } = await import("@vercel/blob");
    await del(storedName, { token: env.BLOB_READ_WRITE_TOKEN });
    return;
  }
  // Delete is idempotent: a missing file is fine, anything else (EACCES,
  // EBUSY) must surface instead of leaving an untracked file behind.
  await unlink(path.join(UPLOADS_DIR, storedName)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
