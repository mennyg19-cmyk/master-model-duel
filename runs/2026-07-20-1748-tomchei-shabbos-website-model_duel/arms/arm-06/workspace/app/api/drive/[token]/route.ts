import { NextResponse } from "next/server";
import { loadDriverRouteView } from "@/lib/routes/lifecycle";
import { requireActiveLink } from "./guard";

export const dynamic = "force-dynamic";

// UR-004/G-025 driver view (magic link — no staff session). The unguessable
// URL token is the credential; a PIN-protected link additionally demands the
// PIN cookie issued by POST .../pin. Reads are minimized: recipient name,
// address, contents — never customer contact PII or order internals.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const guard = await requireActiveLink(token);
  if ("response" in guard) return guard.response;

  const view = await loadDriverRouteView(guard.link.route.id);
  return NextResponse.json({ ok: true, route: view });
}
