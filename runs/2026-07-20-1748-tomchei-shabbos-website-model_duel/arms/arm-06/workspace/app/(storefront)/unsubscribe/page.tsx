import type { Metadata } from "next";
import Link from "next/link";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/newsletter/tokens";
import { UnsubscribeForm } from "@/app/(storefront)/unsubscribe/unsubscribe-form";

export const metadata: Metadata = { title: "Email preferences" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ token?: string }>;
}

// R-018: token-verified preference states. The token is validated server-side
// before the subscriber's current state is ever read or shown.
export default async function UnsubscribePage({ searchParams }: Props) {
  const { token } = await searchParams;

  const verified = token ? await verifyUnsubscribeToken(token, env.AUTH_SECRET) : null;
  const subscriber = verified
    ? await prisma.newsletterSubscriber.findUnique({ where: { id: verified.subscriberId } })
    : null;

  if (!token || !verified || !subscriber) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-stone-900">Email preferences</h1>
        <p className="mt-4 text-stone-600">
          That preferences link is invalid or has expired. Links are good for 30 days — request a
          fresh one by subscribing again below.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          Back to home
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-bold text-stone-900">Email preferences</h1>
      <p className="mt-2 text-sm text-stone-600">
        Managing <span className="font-medium text-stone-900">{subscriber.email}</span>
        {subscriber.unsubscribedAt && (
          <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
            unsubscribed from all
          </span>
        )}
      </p>
      <UnsubscribeForm
        token={token}
        initialPrefs={{
          prefNewProducts: subscriber.prefNewProducts,
          prefReminders: subscriber.prefReminders,
          prefCommunity: subscriber.prefCommunity,
        }}
        initialUnsubscribed={subscriber.unsubscribedAt !== null}
      />
    </main>
  );
}
