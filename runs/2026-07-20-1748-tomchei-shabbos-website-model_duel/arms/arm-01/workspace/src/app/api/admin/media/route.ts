import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

const allowedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const maximumUploadBytes = 5 * 1024 * 1024;

function safeFilename(filename: string) {
  return filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function POST(request: Request) {
  try {
    const staffSession = await requirePermission("settings:manage");
    const formData = await request.formData();
    const upload = formData.get("file");
    if (!(upload instanceof File)) {
      return NextResponse.json({ error: "Choose an image to upload." }, { status: 400 });
    }
    if (!allowedImageTypes.has(upload.type)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, WebP, and GIF images are allowed." },
        { status: 415 },
      );
    }
    if (upload.size <= 0 || upload.size > maximumUploadBytes) {
      return NextResponse.json(
        { error: "Images must be larger than 0 bytes and no more than 5 MB." },
        { status: 413 },
      );
    }

    const pathname = `catalog/${Date.now()}-${safeFilename(upload.name)}`;
    let storedImage: { pathname: string; url: string; contentType: string };
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      storedImage = await put(pathname, upload, {
        access: "public",
        addRandomSuffix: true,
        contentType: upload.type,
      });
    } else if (process.env.ENABLE_TEST_AUTH === "true") {
      const encodedImage = Buffer.from(await upload.arrayBuffer()).toString("base64");
      storedImage = {
        pathname: `smoke/${pathname}`,
        url: `data:${upload.type};base64,${encodedImage}`,
        contentType: upload.type,
      };
    } else {
      return NextResponse.json(
        { error: "Media storage is not configured. Set BLOB_READ_WRITE_TOKEN before uploading." },
        { status: 503 },
      );
    }

    const mediaAsset = await db.$transaction(async (transaction) => {
      const createdAsset = await transaction.mediaAsset.create({
        data: {
          pathname: storedImage.pathname,
          url: storedImage.url,
          contentType: storedImage.contentType,
          sizeBytes: upload.size,
          uploadedBy: staffSession.actor.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorStaffId: staffSession.actor.id,
          action: "media.uploaded",
          targetType: "MediaAsset",
          targetId: createdAsset.id,
          metadata: { pathname: createdAsset.pathname, sizeBytes: upload.size },
        },
      });
      return createdAsset;
    });
    return NextResponse.json({ mediaAsset }, { status: 201 });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
