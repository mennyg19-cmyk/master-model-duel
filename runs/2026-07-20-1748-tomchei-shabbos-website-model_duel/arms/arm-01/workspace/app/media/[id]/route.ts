import { db } from "@/lib/db";
import { readLocalMedia } from "@/lib/media";

/** Serves locally stored media library bytes. Blob-stored assets carry absolute URLs and never hit this route. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset || asset.storage !== "local") {
    return new Response("Not found", { status: 404 });
  }
  const bytes = await readLocalMedia(asset.id);
  if (!bytes) return new Response("File missing on disk", { status: 404 });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
