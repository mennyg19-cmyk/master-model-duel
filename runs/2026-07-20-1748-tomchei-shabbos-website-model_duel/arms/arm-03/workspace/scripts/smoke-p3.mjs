import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const base = process.env.APP_URL || "http://127.0.0.1:3103";
const hmacSecret = process.env.NEWSLETTER_HMAC_SECRET;
const evidence = [];
const db = new PrismaClient();

function cookieHeader(userId) {
  return { cookie: `dev_user_id=${userId}` };
}

function signToken(subscriberId, tokenVersion, exp) {
  const payload = `${subscriberId}.${tokenVersion}.${exp}`;
  const sig = createHmac("sha256", hmacSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

async function req(pathname, init = {}) {
  const res = await fetch(`${base}${pathname}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json, headers: res.headers };
}

function push(id, check, pass, extra = {}) {
  evidence.push({ id, check, pass, ...extra });
}

async function main() {
  if (!hmacSecret) {
    throw new Error("NEWSLETTER_HMAC_SECRET must be set for P3 smoke");
  }

  const home = await req("/");
  push("S1a", "Homepage renders", home.status === 200 && home.text.includes("How it works"), {
    status: home.status,
  });

  const catalog = await req("/catalog");
  push(
    "S1b",
    "Catalog grid + seeded products",
    catalog.status === 200 &&
      catalog.text.includes("catalog-grid") &&
      catalog.text.includes("Family Mishloach Manot") &&
      catalog.text.includes("Sold out"),
    { status: catalog.status },
  );

  const archive = await req("/archive");
  push(
    "S1c",
    "Archive years list",
    archive.status === 200 && archive.text.includes("Purim 2025"),
    { status: archive.status },
  );

  const archiveSeason = await req("/archive/purim-2025");
  push(
    "S2a",
    "Archive browse-only",
    archiveSeason.status === 200 &&
      archiveSeason.text.includes("archive-browse-only") &&
      !archiveSeason.text.includes("Start order"),
    { status: archiveSeason.status },
  );

  // Close season → /order blocked; reopen after.
  const seasons = await req("/api/admin/catalog", { headers: cookieHeader("dev_manager_1") });
  const current = seasons.json?.seasons?.find((s) => s.slug === "purim-2026");
  let closedOk = false;
  let reopened = false;
  if (current) {
    await req("/api/admin/season-gate", {
      method: "POST",
      headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
      body: JSON.stringify({ seasonId: current.id, status: "CLOSED" }),
    });
    const blocked = await req("/order");
    const nestedBlocked = await req("/order/anything");
    closedOk =
      blocked.status === 200 &&
      blocked.text.includes("order-blocked") &&
      !blocked.text.includes("order-open-placeholder") &&
      nestedBlocked.text.includes("order-blocked");
    const homeClosed = await req("/");
    const bannerOk = homeClosed.text.includes("store-closed-banner") || homeClosed.text.includes("Store closed");
    push("S2b", "Closed season blocks /order + banner", closedOk && bannerOk, {
      closedOk,
      bannerOk,
      nestedBlocked: nestedBlocked.text.includes("order-blocked"),
    });
    await req("/api/admin/season-gate", {
      method: "POST",
      headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
      body: JSON.stringify({ seasonId: current.id, status: "OPEN" }),
    });
    const openAgain = await req("/order");
    reopened = openAgain.text.includes("order-open-placeholder");
    push("S2c", "Reopen season restores /order", reopened);
  } else {
    push("S2b", "Closed season blocks /order + banner", false, { error: "missing season" });
    push("S2c", "Reopen season restores /order", false);
  }

  const smokeEmail = `newsletter-smoke-${Date.now()}@tomchei.local`;
  const sub = await req("/api/newsletter/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: smokeEmail,
      preferences: { seasons: true, updates: false },
    }),
  });
  // H3: subscribe must NOT return unsubscribeToken to caller.
  const noTokenLeaked = !sub.json?.unsubscribeToken;
  const row = await db.newsletterSubscriber.findFirst({
    where: { email: smokeEmail },
  });
  const token = row
    ? signToken(row.id, row.tokenVersion, Date.now() + 1000 * 60 * 60)
    : null;
  const unsub = token
    ? await req("/api/newsletter/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
    : { status: 0, json: null };
  const tampered = await req("/api/newsletter/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: (token || "a.1.1.sig") + "x" }),
  });
  const expiredPayload = `fakeid.1.${Date.now() - 1000}`;
  const expiredSig = createHmac("sha256", hmacSecret).update(expiredPayload).digest("base64url");
  const expired = await req("/api/newsletter/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: `${expiredPayload}.${expiredSig}` }),
  });
  // H1: preferences without token must fail
  const prefsIdor = await req("/api/newsletter/preferences", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: smokeEmail,
      preferences: { seasons: false, updates: false },
    }),
  });
  push(
    "S3",
    "Newsletter subscribe → unsubscribe; reject tampered/expired; no token leak",
    sub.status === 200 &&
      noTokenLeaked &&
      unsub.status === 200 &&
      tampered.status === 400 &&
      expired.status === 400 &&
      prefsIdor.status >= 400,
    {
      sub: sub.status,
      noTokenLeaked,
      unsub: unsub.status,
      tampered: tampered.status,
      expired: expired.status,
      prefsIdor: prefsIdor.status,
    },
  );

  // Media: allow PNG, reject text + html/svg XSS vectors
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const pngForm = new FormData();
  pngForm.append("file", new Blob([pngBytes], { type: "image/png" }), "dot.png");
  pngForm.append("altText", "smoke");
  const uploadOk = await fetch(`${base}/api/admin/media`, {
    method: "POST",
    headers: cookieHeader("dev_manager_1"),
    body: pngForm,
  }).then(async (res) => ({ status: res.status, json: await res.json() }));

  const badForm = new FormData();
  badForm.append("file", new Blob(["not-an-image"], { type: "text/plain" }), "notes.txt");
  const uploadBad = await fetch(`${base}/api/admin/media`, {
    method: "POST",
    headers: cookieHeader("dev_manager_1"),
    body: badForm,
  }).then(async (res) => ({ status: res.status, json: await res.json() }));

  const htmlForm = new FormData();
  htmlForm.append("file", new Blob(["<script>alert(1)</script>"], { type: "image/png" }), "evil.html");
  const uploadHtml = await fetch(`${base}/api/admin/media`, {
    method: "POST",
    headers: cookieHeader("dev_manager_1"),
    body: htmlForm,
  }).then(async (res) => ({ status: res.status, json: await res.json() }));

  const svgForm = new FormData();
  svgForm.append("file", new Blob(["<svg xmlns='http://www.w3.org/2000/svg'></svg>"], { type: "image/png" }), "evil.svg");
  const uploadSvg = await fetch(`${base}/api/admin/media`, {
    method: "POST",
    headers: cookieHeader("dev_manager_1"),
    body: svgForm,
  }).then(async (res) => ({ status: res.status, json: await res.json() }));

  // Link media → product for S4 (B3 path)
  const linkTargetSku = `SMOKE-${Date.now().toString(36).toUpperCase()}`;
  const createProduct = await req("/api/admin/catalog", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({
      seasonId: current?.id,
      sku: linkTargetSku,
      name: "Smoke Admin Product",
      slug: `smoke-admin-${Date.now().toString(36)}`,
      category: "Packages",
      description: "Created in P3 smoke",
      basePriceCents: 3300,
      onHand: 5,
      options: [{ name: "Standard", priceAdjustmentCents: 0 }],
    }),
  });
  const productId = createProduct.json?.product?.id;
  const mediaId = uploadOk.json?.media?.id;
  const linked =
    productId && mediaId
      ? await req("/api/admin/media", {
          method: "POST",
          headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
          body: JSON.stringify({ intent: "link", productId, mediaAssetId: mediaId }),
        })
      : { status: 0, json: null };

  const catalogAfter = await req("/catalog");
  push(
    "S4",
    "Media upload allow/reject + link to product + storefront",
    uploadOk.status === 200 &&
      uploadBad.status === 400 &&
      uploadHtml.status === 400 &&
      uploadSvg.status === 400 &&
      createProduct.status === 200 &&
      linked.status === 200 &&
      catalogAfter.text.includes("Smoke Admin Product"),
    {
      uploadOk: uploadOk.status,
      uploadBad: uploadBad.status,
      uploadHtml: uploadHtml.status,
      uploadSvg: uploadSvg.status,
      createProduct: createProduct.status,
      linked: linked.status,
      linkPayload: linked.json?.link,
    },
  );

  // Delivery ZIP edit → checkout gate updates
  const zipPatch = await req("/api/admin/store-settings", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({
      key: "shipping.deliveryZips",
      value: { zips: ["99999"] },
    }),
  });
  const blockedZip = await req("/api/storefront/status?zip=11218");
  const allowedZip = await req("/api/storefront/status?zip=99999");
  // restore
  await req("/api/admin/store-settings", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({
      key: "shipping.deliveryZips",
      value: { zips: ["11218", "11219", "11230", "11204"] },
    }),
  });
  push(
    "S5",
    "Delivery ZIP settings update blocks immediately",
    zipPatch.status === 200 &&
      blockedZip.json?.zipAllowed === false &&
      allowedZip.json?.zipAllowed === true,
    {
      zipPatch: zipPatch.status,
      blocked: blockedZip.json,
      allowed: allowedZip.json,
    },
  );

  const failed = evidence.filter((row) => !row.pass);
  const report = {
    phase: "P3",
    base,
    at: new Date().toISOString(),
    pass: failed.length === 0,
    evidence,
  };

  const outDir = path.join(process.cwd(), ".scratch");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "PHASE-P3-SMOKE.md"),
    [
      "# PHASE-P3-SMOKE",
      "",
      `pass: **${report.pass}**`,
      `at: ${report.at}`,
      `base: ${report.base}`,
      "",
      "## Checks",
      "",
      ...evidence.map(
        (row) =>
          `- [${row.pass ? "x" : " "}] ${row.id} ${row.check}${row.pass ? "" : ` — ${JSON.stringify(row)}`}`,
      ),
      "",
      "```json",
      JSON.stringify(report, null, 2),
      "```",
      "",
    ].join("\n"),
  );

  console.log(JSON.stringify(report, null, 2));
  await db.$disconnect();
  if (failed.length) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
