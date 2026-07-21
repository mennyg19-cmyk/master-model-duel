import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { apiErrorResponse } from "@/lib/api-error";
import {
  linkMediaToProduct,
  listMedia,
  productsNeedingPhotos,
  storeMedia,
  validateUpload,
} from "@/lib/storefront/media";

export async function GET() {
  try {
    await requirePermission("settings.read");
    const [media, needsPhotos] = await Promise.all([listMedia(), productsNeedingPhotos()]);
    return NextResponse.json({ ok: true, media, needsPhotos });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("settings.write");
    const contentType = request.headers.get("content-type") || "";

    // JSON: link existing media → product (primaryImageUrl + mediaAssetId).
    if (contentType.includes("application/json")) {
      const body = z
        .object({
          intent: z.literal("link"),
          productId: z.string().min(1),
          mediaAssetId: z.string().min(1),
        })
        .parse(await request.json());
      const linked = await linkMediaToProduct(body.productId, body.mediaAssetId);
      if (!linked.ok) {
        return NextResponse.json({ error: linked.publicMessage }, { status: 400 });
      }
      await writeAudit({
        action: "MEDIA_UPLOADED",
        actorId: ctx.effectiveStaff.id,
        meta: { ...linked.value, linked: true },
      });
      return NextResponse.json({ ok: true, link: linked.value });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }
    const altText = String(form.get("altText") || "");
    const productId = String(form.get("productId") || "").trim();

    const precheck = validateUpload({ type: file.type, size: file.size, name: file.name });
    if (!precheck.ok) {
      await writeAudit({
        action: "MEDIA_REJECTED",
        actorId: ctx.effectiveStaff.id,
        meta: { reason: precheck.error, type: file.type, name: file.name },
      });
      return NextResponse.json({ error: precheck.publicMessage, reason: precheck.error }, { status: 400 });
    }

    const stored = await storeMedia(file, altText);
    if (!stored.ok) {
      await writeAudit({
        action: "MEDIA_REJECTED",
        actorId: ctx.effectiveStaff.id,
        meta: { reason: stored.error },
      });
      return NextResponse.json({ error: stored.publicMessage }, { status: 400 });
    }

    let link = null;
    if (productId) {
      const linked = await linkMediaToProduct(productId, stored.value.id);
      if (!linked.ok) {
        return NextResponse.json(
          { error: linked.publicMessage, media: stored.value },
          { status: 400 },
        );
      }
      link = linked.value;
      await writeAudit({
        action: "MEDIA_UPLOADED",
        actorId: ctx.effectiveStaff.id,
        meta: { ...linked.value, linked: true },
      });
    }

    await writeAudit({
      action: "MEDIA_UPLOADED",
      actorId: ctx.effectiveStaff.id,
      meta: { mediaId: stored.value.id, pathname: stored.value.pathname },
    });
    return NextResponse.json({ ok: true, media: stored.value, link });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
