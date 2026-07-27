import assert from "node:assert/strict";
import test from "node:test";
import { addStaff, updateStaff } from "../lib/staff-store";
import { prisma } from "../lib/db";

test("ten versioned updates produce one winner and conflicts", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const actor = await prisma.staffUser.create({
    data: {
      clerkUserId: `actor-${crypto.randomUUID()}`,
      displayName: "Test Manager",
      email: `manager-${crypto.randomUUID()}@test.local`,
      role: "MANAGER",
    },
  });
  const created = await addStaff(
    actor.id,
    `fixture-${crypto.randomUUID()}`,
    "Concurrent Fixture",
    `fixture-${crypto.randomUUID()}@test.local`,
    "STAFF",
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const attempts = await Promise.all(
    Array.from({ length: 10 }, () =>
      updateStaff(actor.id, created.staffMember.id, 1, { role: "STAFF", overrides: {} }),
    ),
  );
  assert.equal(attempts.filter((attempt) => attempt.ok).length, 1);
  assert.equal(attempts.filter((attempt) => !attempt.ok && attempt.status === 409).length, 9);
});
