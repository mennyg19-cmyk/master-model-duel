import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

// R-084: subscriber management — the same NewsletterSubscriber rows the
// public subscribe flow writes, with their three preference flags and global
// unsubscribe state, plus which lists each belongs to.
export async function GET() {
  const gate = await requireApiPermission("email.manage");
  if (!gate.ok) return gate.response;

  const subscribers = await prisma.newsletterSubscriber.findMany({
    orderBy: { createdAt: "desc" },
    include: { listMemberships: { include: { list: { select: { id: true, name: true } } } } },
  });
  return NextResponse.json({ ok: true, subscribers });
}
