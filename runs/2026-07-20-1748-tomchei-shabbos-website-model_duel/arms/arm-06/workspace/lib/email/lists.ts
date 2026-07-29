import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";

// The one "list or 404" lookup the email-hub routes share — same contract as
// getCampaignOrThrow (m23): a missing row throws NotFoundError, which
// mapDomainError turns into the consistent { error } 404.
export async function getEmailListOrThrow(listId: string) {
  const list = await prisma.emailList.findUnique({ where: { id: listId } });
  if (!list) throw new NotFoundError("EmailList", listId);
  return list;
}
