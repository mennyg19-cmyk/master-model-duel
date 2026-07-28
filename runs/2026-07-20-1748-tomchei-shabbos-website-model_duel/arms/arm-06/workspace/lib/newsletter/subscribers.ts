import { NewsletterSubscriber } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeEmail, normalizeWhitespace } from "@/lib/text";

// R-009: subscribe upserts on the unique email; a returning subscriber is
// reactivated (unsubscribedAt cleared) but keeps their preference choices.
export async function upsertSubscriber(input: {
  email: string;
  name?: string | null;
}): Promise<{ subscriber: NewsletterSubscriber; created: boolean }> {
  const email = normalizeEmail(input.email);
  const name = input.name ? normalizeWhitespace(input.name) : null;

  const existing = await prisma.newsletterSubscriber.findUnique({ where: { email } });
  if (existing) {
    const subscriber = await prisma.newsletterSubscriber.update({
      where: { id: existing.id },
      data: { unsubscribedAt: null, ...(name ? { name } : {}) },
    });
    return { subscriber, created: false };
  }

  const subscriber = await prisma.newsletterSubscriber.create({
    data: { email, name },
  });
  return { subscriber, created: true };
}

export interface PreferenceUpdate {
  prefNewProducts: boolean;
  prefReminders: boolean;
  prefCommunity: boolean;
}

export async function applyPreferences(
  subscriberId: string,
  update: { unsubscribeAll: boolean; prefs?: PreferenceUpdate },
): Promise<NewsletterSubscriber> {
  return prisma.newsletterSubscriber.update({
    where: { id: subscriberId },
    data: {
      unsubscribedAt: update.unsubscribeAll ? new Date() : null,
      ...(update.prefs ?? {}),
    },
  });
}
