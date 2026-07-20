import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

// ponytail: node stdlib scrypt instead of a bcrypt dependency.
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const derived = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return derived.length === expectedBuffer.length && timingSafeEqual(derived, expectedBuffer);
}
