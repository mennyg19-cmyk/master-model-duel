/**
 * What may be uploaded to the media library (R-067).
 *
 * The rule is deliberately narrow: three raster image formats, nothing else.
 * SVG is excluded even though it is an image, because an SVG is a document that
 * can carry script and would be served from the site's own origin.
 *
 * Three things have to agree before a file is accepted — the extension, the
 * declared content type, and the bytes themselves. The browser controls the
 * first two, so the bytes are what actually decides.
 */

export const ALLOWED_IMAGE_TYPES = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
} as const;

export type AllowedImageType = keyof typeof ALLOWED_IMAGE_TYPES;

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type UploadRejection =
  | 'empty'
  | 'too_large'
  | 'unsupported_type'
  | 'extension_mismatch'
  | 'content_mismatch'
  | 'missing_alt_text';

export const UPLOAD_REJECTION_MESSAGES: Record<UploadRejection, string> = {
  empty: 'That file is empty. Choose an image and try again.',
  too_large: `Images must be ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB or smaller.`,
  unsupported_type: `Only ${Object.keys(ALLOWED_IMAGE_TYPES).join(', ')} images can be uploaded.`,
  extension_mismatch: 'The file extension does not match the kind of file it claims to be.',
  content_mismatch: 'That file is not the image it claims to be, so it was not stored.',
  missing_alt_text: 'Describe the image so screen readers can announce it.',
};

export type UploadValidation =
  | { valid: true; contentType: AllowedImageType; extension: string }
  | { valid: false; reason: UploadRejection };

export function validateImageUpload(input: {
  filename: string;
  declaredContentType: string;
  bytes: Uint8Array;
  altText: string;
}): UploadValidation {
  if (input.altText.trim().length === 0) return { valid: false, reason: 'missing_alt_text' };
  if (input.bytes.byteLength === 0) return { valid: false, reason: 'empty' };
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) return { valid: false, reason: 'too_large' };

  const declared = input.declaredContentType.split(';')[0].trim().toLowerCase();
  if (!isAllowedType(declared)) return { valid: false, reason: 'unsupported_type' };

  const extension = extensionOf(input.filename);
  if (!extension || !(ALLOWED_IMAGE_TYPES[declared] as readonly string[]).includes(extension)) {
    return { valid: false, reason: 'extension_mismatch' };
  }

  if (sniffImageType(input.bytes) !== declared) return { valid: false, reason: 'content_mismatch' };

  return { valid: true, contentType: declared, extension };
}

/** Reads the format from the file's own header rather than trusting the upload. */
export function sniffImageType(bytes: Uint8Array): AllowedImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  const isRiff = startsWith(bytes, [0x52, 0x49, 0x46, 0x46]);
  const isWebp = bytes.byteLength >= 12 && startsWith(bytes.subarray(8, 12), [0x57, 0x45, 0x42, 0x50]);
  if (isRiff && isWebp) return 'image/webp';

  return null;
}

/**
 * The stored name never reuses what the browser sent: an upload called
 * `../../.env.png` must not be able to point anywhere but inside the folder.
 */
export function buildPathname(input: {
  originalFilename: string;
  extension: string;
  uniqueSuffix: string;
  seasonYear: number;
}): string {
  const stem = input.originalFilename
    .replace(/\.[^.]*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return `catalog/${input.seasonYear}/${stem || 'image'}-${input.uniqueSuffix}.${input.extension}`;
}

function isAllowedType(value: string): value is AllowedImageType {
  return value in ALLOWED_IMAGE_TYPES;
}

function extensionOf(filename: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : null;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.byteLength < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}
