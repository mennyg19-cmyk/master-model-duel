import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { UPLOADS_DIR } from "@/lib/media/storage";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ name: string }>;
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

// Serves the local storage driver's files. Names are UUID + extension from
// the upload route; the strict pattern keeps this from ever becoming a
// path-traversal reader.
export async function GET(_request: Request, { params }: Props) {
  const { name } = await params;
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(name)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const extension = name.split(".").pop() as string;
  try {
    const bytes = await readFile(path.join(UPLOADS_DIR, name));
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": CONTENT_TYPES[extension],
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
