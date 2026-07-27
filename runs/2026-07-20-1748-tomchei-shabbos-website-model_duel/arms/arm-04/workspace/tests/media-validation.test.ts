import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET ??= "test-secret-at-least-16-chars";
process.env.DATABASE_URL ??= "postgresql://duel:duel@127.0.0.1:4102/tomchei";

// Dynamic import so the env vars above are set before lib/env validates them.
const mediaModule = import("../lib/media");

test("recognizes real image signatures", async () => {
  const { detectImageType } = await mediaModule;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  assert.equal(detectImageType(png)?.contentType, "image/png");

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  assert.equal(detectImageType(jpeg)?.contentType, "image/jpeg");

  const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(4)]);
  assert.equal(detectImageType(gif)?.contentType, "image/gif");

  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
  assert.equal(detectImageType(webp)?.contentType, "image/webp");
});

test("rejects non-image bytes regardless of claimed name", async () => {
  const { detectImageType } = await mediaModule;
  assert.equal(detectImageType(Buffer.from("MZ\x90\x00 this is an exe")), null);
  assert.equal(detectImageType(Buffer.from("<html>not an image</html>")), null);
  assert.equal(detectImageType(Buffer.alloc(0)), null);
});
