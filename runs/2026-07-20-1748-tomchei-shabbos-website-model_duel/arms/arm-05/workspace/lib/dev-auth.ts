import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_HEADER = "x-dev-session";

export type DevSession = {
  userId: string;
  email: string;
  expiresAt: number;
};

function secret() {
  return process.env.DEV_AUTH_SECRET;
}

export function isDevAuthEnabled() {
  return process.env.NODE_ENV === "development"
    && process.env.DEV_AUTH_MODE === "true"
    && Boolean(secret());
}

function sign(payload: string, signingSecret: string) {
  return createHmac("sha256", signingSecret).update(payload).digest("base64url");
}

export function createDevSessionToken(session: DevSession) {
  const signingSecret = secret();
  if (!signingSecret) throw new Error("DEV_AUTH_SECRET is required to create a development session.");
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload, signingSecret)}`;
}

export function readDevSession(request: Request): DevSession | null {
  if (!isDevAuthEnabled()) return null;
  const token = request.headers.get(SESSION_HEADER);
  const signingSecret = secret();
  if (!token || !signingSecret) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expectedSignature = sign(payload, signingSecret);
  if (signature.length !== expectedSignature.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as DevSession;
    if (
      typeof session.userId !== "string"
      || typeof session.email !== "string"
      || typeof session.expiresAt !== "number"
      || session.expiresAt <= Date.now()
    ) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}
