/** Normalized forms used as dedupe keys for customers and address books. */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
