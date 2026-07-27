import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCents } from "../lib/catalog";
import { renderTemplate, TEMPLATE_DEFAULTS } from "../lib/email/templates";

test("renderTemplate fills known placeholders and leaves unknown tokens visible", () => {
  const rendered = renderTemplate("Hi {{name}}, order #{{orderNumber}} — {{mystery}}", {
    name: "Rivka",
    orderNumber: "7",
  });
  assert.equal(rendered, "Hi Rivka, order #7 — {{mystery}}");
});

test("every default template renders cleanly with its declared placeholders", () => {
  for (const [key, template] of Object.entries(TEMPLATE_DEFAULTS)) {
    const values = Object.fromEntries(template.placeholders.map((name) => [name, `<${name}>`]));
    const subject = renderTemplate(template.subject, values);
    const body = renderTemplate(template.body, values);
    assert.ok(!subject.includes("{{"), `${key} subject left an unfilled token: ${subject}`);
    assert.ok(!body.includes("{{"), `${key} body left an unfilled token: ${body}`);
  }
});

test("formatCents renders whole and fractional dollars", () => {
  assert.equal(formatCents(3600), "$36.00");
  assert.equal(formatCents(105), "$1.05");
});
