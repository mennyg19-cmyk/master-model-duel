import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDraftReference, parseDraftReference } from '../src/lib/orders/draft-reference';

test('a generated reference is in wire format and parses back to itself', () => {
  const reference = createDraftReference();

  assert.match(reference, /^D-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{5}$/);
  assert.equal(parseDraftReference(reference), reference);
});

test('a reference read back over the phone still parses', () => {
  const reference = createDraftReference();
  const asHeard = reference.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');

  assert.equal(parseDraftReference(asHeard), reference);
});

test('a mistyped symbol fails the checksum instead of finding someone else’s cart', () => {
  const reference = createDraftReference();
  const symbols = reference.replace(/-/g, '');
  const wrongFirstSymbol = symbols[1] === 'Z' ? 'Y' : 'Z';
  const mistyped = `${symbols[0]}${wrongFirstSymbol}${symbols.slice(2)}`;

  assert.equal(parseDraftReference(mistyped), null);
});

test('a truncated or empty reference is refused', () => {
  assert.equal(parseDraftReference(''), null);
  assert.equal(parseDraftReference('D-4F7K'), null);
});

test('two references in a row are different', () => {
  assert.notEqual(createDraftReference(), createDraftReference());
});
