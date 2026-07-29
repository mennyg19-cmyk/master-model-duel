import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { loadDriverRouteView } from "@/lib/routes/lifecycle";
import { DRIVER_PIN_COOKIE, loadLinkByToken, verifyPinCookie } from "@/lib/routes/links";

export const dynamic = "force-dynamic";

// UR-004/G-025 driver view (magic link — no staff session). The unguessable
// URL token is the credential; a PIN-protected link additionally demands the
// PIN cookie issued by POST .../pin. Reads are minimized: recipient name,
// address, contents — never customer contact PII or order internals.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { state, link } = await loadLinkByToken(token);
  if (state !== "active" || !link) {
    const status = state === "invalid" ? 404 : 410;
    return NextResponse.json({ error: state === "completed" ? "Route completed — this link is closed" : state === "expired" ? "Link expired" : "Unknown link", state }, { status });
  }
  if (link.pinHash) {
    const jar = await cookies();
    const passed = await verifyPinCookie(jar.get(DRIVER_PIN_COOKIE)?.value, link.id);
    if (!passed) {
      return NextResponse.json({ error: "PIN required", state: "pin_required" }, { status: 403 });
    }
  }

  const view = await loadDriverRouteView(link.route.id);
  return NextResponse.json({ ok: true, route: view });
}
