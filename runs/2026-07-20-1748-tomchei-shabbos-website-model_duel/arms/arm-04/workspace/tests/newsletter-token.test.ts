import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET ??= "test-secret-at-least-16-chars";
process.env.DATABASE_URL ??= "postgresql://duel:duel@127.0.0.1:4102/tomchei";

// Dynamic import so the env vars above are set before lib/env validates them.
const tokenModule = import("../lib/newsletter-token");

test("round-trips a valid token back to the email", async () => {
  const { createNewsletterToken, verifyNewsletterToken } = await tokenModule;
  const token = createNewsletterToken("Someone@Example.com");
  assert.equal(verifyNewsletterToken(token), "someone@example.com");
});

test("rejects a tampered token", async () => {
  const { createNewsletterToken, verifyNewsletterToken } = await tokenModule;
  const token = createNewsletterToken("someone@example.com");
  const [encodedEmail, expires, signature] = token.split(".");
  const otherEmail = Buffer.from("attacker@example.com").toString("base64url");
  assert.equal(verifyNewsletterToken(`${otherEmail}.${expires}.${signature}`), null);
  assert.equal(verifyNewsletterToken(`${encodedEmail}.${Number(expires) + 9999999}.${signature}`), null);
  assert.equal(verifyNewsletterToken(token.slice(0, -2) + "xx"), null);
});

test("rejects an expired token", async () => {
  const { createNewsletterToken, verifyNewsletterToken } = await tokenModule;
  const token = createNewsletterToken("someone@example.com", -1000);
  assert.equal(verifyNewsletterToken(token), null);
});

test("rejects garbage", async () => {
  const { verifyNewsletterToken } = await tokenModule;
  assert.equal(verifyNewsletterToken(""), null);
  assert.equal(verifyNewsletterToken("a.b"), null);
  assert.equal(verifyNewsletterToken("not.a.token"), null);
});
