import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyNewsletterToken } from "@/lib/newsletter";

function invalidTokenResponse() {
  return NextResponse.json(
    { error: "This newsletter link is invalid or expired." },
    { status: 401 },
  );
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const verifiedToken = verifyNewsletterToken(token);
  if (!verifiedToken) return invalidTokenResponse();

  const subscriber = await db.newsletterSubscriber.findUnique({
    where: { id: verifiedToken.subscriberId },
  });
  if (!subscriber) return invalidTokenResponse();

  return NextResponse.json({
    email: subscriber.email,
    productUpdates: subscriber.productUpdates,
    volunteerStories: subscriber.volunteerStories,
    communityImpact: subscriber.communityImpact,
    isSubscribed: subscriber.isSubscribed,
  });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    token?: string;
    productUpdates?: boolean;
    volunteerStories?: boolean;
    communityImpact?: boolean;
    isSubscribed?: boolean;
  };
  const verifiedToken = verifyNewsletterToken(body.token ?? "");
  if (!verifiedToken) return invalidTokenResponse();

  const subscriber = await db.newsletterSubscriber.update({
    where: { id: verifiedToken.subscriberId },
    data: {
      productUpdates: body.productUpdates,
      volunteerStories: body.volunteerStories,
      communityImpact: body.communityImpact,
      isSubscribed: body.isSubscribed,
      unsubscribedAt:
        body.isSubscribed === undefined
          ? undefined
          : body.isSubscribed
            ? null
            : new Date(),
    },
  });
  return NextResponse.json({
    message: subscriber.isSubscribed
      ? "Newsletter preferences saved."
      : "You have been unsubscribed.",
  });
}
