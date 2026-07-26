/**
 * One address on one line, for a select option, a list row or an order detail.
 *
 * It sits outside `address-book.ts` because that module is `server-only` and the
 * staff address editor is a client component: without this split the staff screen
 * would have to spell the same address out by hand, which is how two formats of
 * the same address end up on two screens.
 */
export function addressSummary(address: {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
}): string {
  const street = [address.line1, address.line2].filter(Boolean).join(', ');
  return `${street}, ${address.city}, ${address.state} ${address.postalCode}`;
}
