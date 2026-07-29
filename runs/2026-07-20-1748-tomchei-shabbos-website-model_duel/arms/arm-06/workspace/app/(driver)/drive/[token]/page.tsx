import type { Metadata } from "next";
import { loadLinkByToken } from "@/lib/routes/links";
import { Card, CardTitle } from "@/components/ui/card";
import { BRAND } from "@/lib/brand";
import { DriveApp } from "@/app/(driver)/drive/[token]/drive-app";

export const metadata: Metadata = { title: "Delivery route" };
export const dynamic = "force-dynamic";

const STATE_MESSAGES: Record<string, { title: string; body: string }> = {
  invalid: { title: "Unknown link", body: "This delivery link does not exist. Check the text you received or ask the coordinator for a fresh link." },
  expired: { title: "Link expired", body: "This delivery link has expired. Ask the coordinator to send a fresh one." },
  completed: { title: "Route completed", body: "This run is done — every stop was delivered, so the link is closed. Thank you!" },
};

// UR-004/G-025/G-030: the driver's mobile page. Sessionless — the unguessable
// URL token is the credential (plus the PIN cookie when the link is
// protected). Reads are minimized to stop cards; the printed manifest is the
// paper fallback.
export default async function DrivePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { state, link } = await loadLinkByToken(token);

  if (state !== "active" || !link) {
    const message = STATE_MESSAGES[state] ?? STATE_MESSAGES.invalid;
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6">
        <Card className="w-full max-w-md p-8 text-center">
          <CardTitle>{message.title}</CardTitle>
          <p className="mt-3 text-sm text-stone-600">{message.body}</p>
          <p className="mt-6 text-xs text-stone-400">{BRAND.orgName}</p>
        </Card>
      </main>
    );
  }

  return <DriveApp token={token} pinRequired={link.pinHash !== null} />;
}
