import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { getCurrentSeason } from "@/lib/storefront/season";
import { getPrintArtifact } from "@/lib/ops/print-batch";

type Ctx = { params: Promise<{ artifactId: string }> };

function sanitizeFilename(raw: string): string {
  return raw.replace(/["\r\n\\]/g, "_").slice(0, 120);
}

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await requirePermission("admin.access");
    const season = await getCurrentSeason();
    if (!season) {
      return NextResponse.json({ ok: false, error: "No season" }, { status: 409 });
    }
    const { artifactId } = await ctx.params;
    const artifact = await getPrintArtifact(season.id, artifactId);
    if (!artifact) {
      return NextResponse.json({ ok: false, error: "Artifact not found" }, { status: 404 });
    }
    const payload = artifact.payload as {
      pdfDataUrl?: string;
      title?: string;
      lines?: string[];
    };
    const filename = sanitizeFilename(`${artifact.kind}-${artifact.filingGroup}.pdf`);
    if (payload.pdfDataUrl?.startsWith("data:application/pdf;base64,")) {
      const b64 = payload.pdfDataUrl.slice("data:application/pdf;base64,".length);
      const bytes = Buffer.from(b64, "base64");
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="${filename}"`,
          "cache-control": "private, max-age=60",
        },
      });
    }
    return NextResponse.json({
      ok: true,
      artifact: {
        id: artifact.id,
        kind: artifact.kind,
        filingGroup: artifact.filingGroup,
        orderId: artifact.orderId,
        title: payload.title,
        lines: payload.lines,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
