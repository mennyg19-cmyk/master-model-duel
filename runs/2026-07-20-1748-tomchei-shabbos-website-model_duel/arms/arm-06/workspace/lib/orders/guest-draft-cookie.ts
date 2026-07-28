import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// Transport for the raw guest draft token: an httpOnly cookie scoped per
// draft ref. The bearer never appears in URLs (browser history, access logs,
// Referer) or in JS-reachable storage (localStorage) — only the cookie jar
// and the server's HMAC hash ever see it. Max-Age bounds the token's life.
const GUEST_DRAFT_COOKIE_PREFIX = "arm06_guest_draft_";
export const GUEST_DRAFT_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export function guestDraftCookieName(draftRef: string): string {
  return `${GUEST_DRAFT_COOKIE_PREFIX}${draftRef}`;
}

export async function readGuestDraftToken(draftRef: string): Promise<string | undefined> {
  const store = await cookies();
  return store.get(guestDraftCookieName(draftRef))?.value;
}

export function writeGuestDraftTokenCookie(
  response: NextResponse,
  draftRef: string,
  rawToken: string,
): void {
  response.cookies.set(guestDraftCookieName(draftRef), rawToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: GUEST_DRAFT_TOKEN_TTL_SECONDS,
  });
}
