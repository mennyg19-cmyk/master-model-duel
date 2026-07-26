import { normalizeEmail } from '../src/lib/core/normalize';
import { db } from '../src/lib/db';
import { env } from '../src/lib/env';
import { createUnsubscribeToken } from '../src/lib/newsletter/tokens';

/**
 * Prints the signed preferences link for one subscriber.
 *
 * The link normally arrives by email, and sending mail is a later phase, so
 * without this there is no way to open the preferences page in development or
 * to check the unsubscribe flow by hand.
 */
async function main() {
  const email = process.argv[2];
  if (!email) throw new Error('Usage: npm run newsletter:link -- someone@example.com');

  const subscriber = await db.newsletterSubscriber.findUnique({
    where: { normalizedEmail: normalizeEmail(email) },
  });
  if (!subscriber) throw new Error(`${email} is not on the newsletter list.`);

  console.log(`${env.APP_URL}/newsletter/manage?token=${createUnsubscribeToken(subscriber.id)}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
