export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
