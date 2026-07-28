import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { Card, CardTitle } from "@/components/ui/card";
import { ConfirmInviteButton } from "./confirm-invite-button";

export const metadata: Metadata = { title: "Staff invite" };
export const dynamic = "force-dynamic";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const staff = await prisma.staffUser.findUnique({ where: { inviteToken: token } });
  const isValid =
    staff !== null &&
    staff.status === "PENDING" &&
    staff.invitedAt !== null &&
    Date.now() - staff.invitedAt.getTime() <= INVITE_TTL_MS;

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-md p-8">
        <CardTitle>Staff invite</CardTitle>
        {isValid ? (
          <>
            <p className="mt-4 text-sm text-stone-600">
              <strong>{staff.name}</strong> ({staff.email}), you were invited as{" "}
              <strong>{staff.role}</strong>. Confirm to activate the account and sign in.
            </p>
            <ConfirmInviteButton token={token} />
          </>
        ) : (
          <p className="mt-4 text-sm text-stone-600">
            This invite is invalid, was already used, or has expired. Ask a manager for a fresh one.
          </p>
        )}
      </Card>
    </main>
  );
}
