import { test } from "node:test";
import assert from "node:assert/strict";
import { signWebhookPayload, verifyWebhookSignature } from "../lib/payments/webhook-verify";

const SECRET = "whsec_test_secret";

test("a freshly signed payload verifies", () => {
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const header = signWebhookPayload(SECRET, payload);
  assert.ok(verifyWebhookSignature(SECRET, payload, header));
});

test("tampered payload, wrong secret, and missing header are rejected", () => {
  const payload = JSON.stringify({ id: "evt_1", amount: 100 });
  const header = signWebhookPayload(SECRET, payload);
  assert.ok(!verifyWebhookSignature(SECRET, payload.replace("100", "999"), header));
  assert.ok(!verifyWebhookSignature("whsec_other", payload, header));
  assert.ok(!verifyWebhookSignature(SECRET, payload, null));
  assert.ok(!verifyWebhookSignature(SECRET, payload, "t=abc,v1="));
});

test("stale timestamps are rejected", () => {
  const payload = "{}";
  const staleHeader = signWebhookPayload(SECRET, payload, Math.floor(Date.now() / 1000) - 3600);
  assert.ok(!verifyWebhookSignature(SECRET, payload, staleHeader));
});
