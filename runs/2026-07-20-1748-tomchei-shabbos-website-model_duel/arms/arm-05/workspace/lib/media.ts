const allowedMediaTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const maximumImageBytes = 5 * 1024 * 1024;

function matchesMagicBytes(bytes: Uint8Array, extension: string) {
  if (extension === "jpg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (extension === "png") return bytes.slice(0, 8).every((byte, index) => byte === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]);
  return new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF"
    && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}

export async function validateCatalogImage(file: File) {
  const extension = allowedMediaTypes.get(file.type);
  if (!extension || file.size > maximumImageBytes) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  return matchesMagicBytes(bytes, extension) ? extension : null;
}
