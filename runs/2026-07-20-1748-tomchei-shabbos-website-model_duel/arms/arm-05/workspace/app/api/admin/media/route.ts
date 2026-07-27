import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateCatalogImage } from "@/lib/media";
import { authorize, hasSameOrigin } from "@/lib/route-auth";

export async function POST(request: Request) {
  const authorization = await authorize(request, "settings.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload a JPEG, PNG, or WebP image no larger than 5 MB." }, { status: 400 });
  }
  const extension = await validateCatalogImage(file);
  if (!extension) return NextResponse.json({ error: "Upload a JPEG, PNG, or WebP image no larger than 5 MB." }, { status: 400 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Media storage is not configured." }, { status: 503 });
  }

  const blob = await put(`catalog/${randomUUID()}.${extension}`, file, {
    access: "public",
    addRandomSuffix: false,
    contentType: file.type,
  });
  const media = await prisma.mediaAsset.create({
    data: {
      url: blob.url,
      pathname: blob.pathname,
      contentType: blob.contentType,
      sizeBytes: file.size,
    },
  });
  return NextResponse.json({ media }, { status: 201 });
}
