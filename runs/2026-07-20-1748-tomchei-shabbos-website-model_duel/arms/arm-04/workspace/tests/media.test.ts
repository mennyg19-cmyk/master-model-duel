import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildPathname,
  MAX_UPLOAD_BYTES,
  sniffImageType,
  validateImageUpload,
} from '../src/lib/media/validation';
import { createSolidPng } from '../scripts/png';

const PNG = new Uint8Array(createSolidPng(2, 2, [10, 20, 30]));

function upload(overrides: Partial<Parameters<typeof validateImageUpload>[0]> = {}) {
  return validateImageUpload({
    filename: 'box.png',
    declaredContentType: 'image/png',
    bytes: PNG,
    altText: 'A gift box',
    ...overrides,
  });
}

test('a real PNG with alt text is accepted', () => {
  assert.deepEqual(upload(), { valid: true, contentType: 'image/png', extension: 'png' });
  assert.deepEqual(upload({ declaredContentType: 'image/png; charset=binary' }), {
    valid: true,
    contentType: 'image/png',
    extension: 'png',
  });
});

test('an image with no alt text is rejected before anything else', () => {
  assert.deepEqual(upload({ altText: '   ' }), { valid: false, reason: 'missing_alt_text' });
});

test('the bytes decide, not the name or the declared type', () => {
  const script = new TextEncoder().encode('<svg onload="steal()"></svg>');

  assert.deepEqual(upload({ bytes: script }), { valid: false, reason: 'content_mismatch' });
  assert.deepEqual(upload({ filename: 'box.jpg' }), { valid: false, reason: 'extension_mismatch' });
  assert.deepEqual(upload({ declaredContentType: 'image/svg+xml', filename: 'box.svg' }), {
    valid: false,
    reason: 'unsupported_type',
  });
});

test('empty and oversized files are rejected', () => {
  assert.deepEqual(upload({ bytes: new Uint8Array(0) }), { valid: false, reason: 'empty' });

  const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
  oversized.set(PNG.subarray(0, 8));
  assert.deepEqual(upload({ bytes: oversized }), { valid: false, reason: 'too_large' });
});

test('image formats are sniffed from their headers', () => {
  assert.equal(sniffImageType(PNG), 'image/png');
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImageType(webpHeader()), 'image/webp');
  assert.equal(sniffImageType(new Uint8Array([1, 2, 3, 4])), null);
});

test('the stored pathname cannot escape the upload folder', () => {
  // Nothing of a traversal attempt survives: no dots, no slashes, no name.
  assert.equal(
    buildPathname({
      originalFilename: '../../.env',
      extension: 'png',
      uniqueSuffix: 'abcd1234',
      seasonYear: 2026,
    }),
    'catalog/2026/image-abcd1234.png',
  );

  assert.equal(
    buildPathname({
      originalFilename: 'Classic Box (Front).PNG',
      extension: 'png',
      uniqueSuffix: 'abcd1234',
      seasonYear: 2026,
    }),
    'catalog/2026/classic-box-front-abcd1234.png',
  );
});

function webpHeader(): Uint8Array {
  const bytes = new Uint8Array(12);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WEBP'), 8);
  return bytes;
}
