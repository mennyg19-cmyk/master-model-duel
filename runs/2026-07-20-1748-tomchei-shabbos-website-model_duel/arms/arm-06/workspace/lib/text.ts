export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Minimal deliverability shape check for imported emails — one rule, one home.
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

// URL-safe slug from a display name; callers still handle the unique-index
// conflict (409) when two names collapse to one slug.
export function slugify(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
