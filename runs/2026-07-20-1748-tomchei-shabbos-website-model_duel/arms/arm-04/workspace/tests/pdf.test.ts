import { test } from "node:test";
import assert from "node:assert/strict";
import { LETTER, paginate, renderPdf, type PdfLine } from "../lib/pdf";

test("renderPdf produces a parseable PDF with all pages", () => {
  const pdf = renderPdf([[{ text: "Hello" }], [{ text: "Page two" }]]);
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.includes("/Count 2"));
  assert.ok(text.includes("(Hello) Tj"));
  assert.ok(text.includes("(Page two) Tj"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
});

test("special characters are escaped, non-Latin-1 replaced", () => {
  const pdf = renderPdf([[{ text: "Levi (Backslash \\) — שלום" }]]);
  const text = pdf.toString("latin1");
  assert.ok(text.includes("\\(Backslash \\\\\\)"));
  assert.ok(!text.includes("שלום")); // replaced by ?, never raw multibyte
});

test("paginate never drops lines, splits at page capacity", () => {
  const lines: PdfLine[] = Array.from({ length: 300 }, (_, index) => ({ text: `line ${index}` }));
  const pages = paginate(lines, LETTER);
  assert.ok(pages.length > 1, "300 lines cannot fit one letter page");
  assert.equal(pages.flat().length, 300);
  const rendered = renderPdf(pages, LETTER).toString("latin1");
  assert.ok(rendered.includes("(line 0) Tj"));
  assert.ok(rendered.includes("(line 299) Tj"));
});
