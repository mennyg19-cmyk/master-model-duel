// R-128: upload restrictions live here so the API route and tests share one
// allowlist. Content type + extension must agree; size is capped; the magic
// bytes must match the declared type (client-sent metadata alone is not
// trusted — a misnamed/polyglot file never reaches storage).
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const MAGIC_SIGNATURES: { contentType: string; matches: (bytes: Uint8Array) => boolean }[] = [
  { contentType: "image/jpeg", matches: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  {
    contentType: "image/png",
    matches: (bytes) =>
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a,
  },
  {
    contentType: "image/gif",
    matches: (bytes) => bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38,
  },
  {
    contentType: "image/webp",
    matches: (bytes) =>
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50,
  },
];

// Detects the declared image type from the leading bytes, or null when the
// bytes match no allowlisted signature.
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const signature = MAGIC_SIGNATURES.find((entry) => entry.matches(bytes));
  return signature?.contentType ?? null;
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export function validateUpload(input: {
  filename: string;
  contentType: string;
  sizeBytes: number;
}): { ok: true; extension: string } | { ok: false; error: string } {
  const extension = ALLOWED_IMAGE_TYPES[input.contentType];
  if (!extension) {
    return { ok: false, error: "Only JPEG, PNG, WebP, or GIF images can be uploaded" };
  }
  if (input.sizeBytes <= 0) {
    return { ok: false, error: "The file is empty" };
  }
  if (input.sizeBytes > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "Images must be 5 MB or smaller" };
  }
  const fileExtension = input.filename.split(".").pop()?.toLowerCase();
  if (fileExtension !== extension && !(extension === "jpg" && fileExtension === "jpeg")) {
    return { ok: false, error: "The file extension does not match its image type" };
  }
  return { ok: true, extension };
}
