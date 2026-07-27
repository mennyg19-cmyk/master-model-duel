import type { AddressParts } from '../addresses/address-mapping';

/**
 * The "take me there" link on a stop card (G-030).
 *
 * Google's universal directions URL rather than a native app scheme: it opens
 * the app on a phone that has it and the website on one that does not, which is
 * the difference between a volunteer driving and a volunteer phoning the office.
 *
 * The address is the whole destination, URL-encoded, so a street called
 * "Ridge & Vine" cannot cut the query string in half.
 */
const DIRECTIONS_URL = 'https://www.google.com/maps/dir/';

export function mapsDirectionsHref(address: AddressParts): string {
  const query = new URLSearchParams({ api: '1', destination: formatDestination(address) });
  return `${DIRECTIONS_URL}?${query.toString()}`;
}

/** One line, the way a person would read it out: street, unit, city, state ZIP. */
function formatDestination(address: AddressParts): string {
  return [
    address.line1,
    address.line2 ?? '',
    address.city,
    [address.state, address.postalCode].filter(Boolean).join(' '),
  ]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(', ');
}
