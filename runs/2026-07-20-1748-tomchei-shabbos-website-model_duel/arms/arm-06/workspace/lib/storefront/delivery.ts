// Per-package delivery ZIP gate (G-014): exact match against the manager's
// allowlist, no overrides. Kept pure so checkout (P5), the settings hub, and
// the smoke probe all run the same rule.
export function normalizePostalCode(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

export function isDeliverable(deliveryZips: string[], postalCode: string): boolean {
  const candidate = normalizePostalCode(postalCode);
  return deliveryZips.includes(candidate);
}
