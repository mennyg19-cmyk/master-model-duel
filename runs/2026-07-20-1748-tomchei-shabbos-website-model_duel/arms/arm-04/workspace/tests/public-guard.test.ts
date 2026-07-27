import { test } from "node:test";
import assert from "node:assert/strict";
import { isSameOrigin } from "../lib/public-guard";
import { env } from "../lib/env";

const allowed = new URL(env.APP_URL).origin;

function post(headers: Record<string, string>): Request {
  return new Request(`${allowed}/api/checkout`, { method: "POST", headers });
}

test("a request carrying neither Origin nor Referer is refused", () => {
  assert.equal(isSameOrigin(post({})), false);
});

test("a foreign Origin or Referer is refused", () => {
  assert.equal(isSameOrigin(post({ origin: "http://evil.example" })), false);
  assert.equal(isSameOrigin(post({ referer: "http://evil.example/checkout" })), false);
});

test("the app's own Origin or Referer passes", () => {
  assert.equal(isSameOrigin(post({ origin: allowed })), true);
  assert.equal(isSameOrigin(post({ referer: `${allowed}/checkout` })), true);
});

test("an unparseable Referer is refused", () => {
  assert.equal(isSameOrigin(post({ referer: "not-a-url" })), false);
});
