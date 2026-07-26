import { deflateSync } from 'node:zlib';

/**
 * Writes a real PNG so the seed, the upload tests and the smoke run all work
 * with bytes an image decoder accepts. A checked-in binary or a base64 blob
 * would be the alternative, and neither can be read in a review.
 *
 * Truecolour, 8 bits per channel, one filter byte per row — the simplest
 * encoding the format allows.
 */
export function createSolidPng(
  width: number,
  height: number,
  rgb: readonly [number, number, number],
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const bytesPerRow = 1 + width * 3;
  const raster = Buffer.alloc(height * bytesPerRow);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * bytesPerRow;
    raster[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const pixel = rowStart + 1 + x * 3;
      raster[pixel] = rgb[0];
      raster[pixel + 1] = rgb[1];
      raster[pixel + 2] = rgb[2];
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raster)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData));

  return Buffer.concat([length, typeAndData, checksum]);
}

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
