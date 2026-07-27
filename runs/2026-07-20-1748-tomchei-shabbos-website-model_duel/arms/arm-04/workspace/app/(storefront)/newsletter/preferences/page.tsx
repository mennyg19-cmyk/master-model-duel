import { db } from "@/lib/db";
import { verifyNewsletterToken } from "@/lib/newsletter-token";
import { PreferencesForm } from "@/components/storefront/preferences-form";

export default async function NewsletterPreferencesPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const email = token ? verifyNewsletterToken(token) : null;
  const subscriber = email
    ? await db.newsletterSubscriber.findUnique({ where: { email } })
    : null;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold">Newsletter preferences</h1>
      {!email || !subscriber ? (
        <p className="mt-4 text-muted" data-testid="token-invalid">
          This preferences link is invalid or has expired. Use the signup form in the footer to
          get a fresh one.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">Settings for {subscriber.email}</p>
          <div className="mt-6">
            <PreferencesForm
              token={token!}
              initial={{
                wantsSeasonOpening: subscriber.wantsSeasonOpening,
                wantsPurimReminders: subscriber.wantsPurimReminders,
                unsubscribed: subscriber.status === "UNSUBSCRIBED",
              }}
            />
          </div>
        </>
      )}
    </main>
  );
}
