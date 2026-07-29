// Unit checks for P11 pure helpers: the template renderer + branding tokens,
// the triggered-key registry, and the no-keys capture mode of the dispatcher
// (R-171/R-178, S5). DB-backed P11 behavior (outbox lifecycle, retry, crons,
// campaigns, order hooks, purge) lives in test-p11-domain.mts.
//
// Capture mode requires the provider keys to be ABSENT when lib/env snapshots
// process.env at import. lib/env evaluates before @prisma/client's dotenv can
// backfill .env (dispatch → resend → env resolves first in the import graph),
// so deleting the keys here keeps the whole process in capture mode.

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:4106/app";
process.env.AUTH_SECRET ??= "0123456789abcdef0123456789abcdef";
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_BASE_URL;
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_FROM_NUMBER;

let failures = 0;

function check(label: string, condition: boolean) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

async function throwsNamed(run: () => Promise<unknown>, name: string): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (error) {
    return (error as Error)?.name === name;
  }
}

// dispatch MUST import first: its graph hits lib/env (snapshot) before any
// chain reaches @prisma/client, whose dotenv would backfill RESEND_* from
// .env and silently flip this file out of capture mode.
const { deliverMessage, currentDeliveryMode } = await import("../lib/email/dispatch");
const { renderTemplate, brandTokens, brandedFrom } = await import("../lib/email/render");
const { TRIGGERED_KEYS, TRIGGERED_DEFAULTS } = await import("../lib/email/triggered");
const { getResendConfig, sendEmail } = await import("../lib/email/resend");
const { isSmsConfigured, sendSms } = await import("../lib/notify/sms");

// --- renderer -----------------------------------------------------------------
check(
  "renderTemplate replaces every occurrence of a known token",
  renderTemplate("{{a}} and {{a}} and {{b}}", { a: "1", b: "2" }) === "1 and 1 and 2",
);
check(
  "renderTemplate leaves unknown tokens literal so staff typos stay visible",
  renderTemplate("hi {{customerName}} / {{typoToken}}", { customerName: "Malka" }) === "hi Malka / {{typoToken}}",
);
check(
  "brandTokens injects brand + footer and lets caller tokens shadow",
  (() => {
    const merged = brandTokens(
      { fromName: "Org", fromEmail: "o@x.org", replyToEmail: "r@x.org", footerText: "F" },
      { brand: "Shadow", customerName: "Malka" },
    );
    return merged.brand === "Shadow" && merged.footer === "F" && merged.customerName === "Malka";
  })(),
);
check(
  "brandedFrom renders the RFC from-line",
  brandedFrom({ fromName: "Tomchei", fromEmail: "t@x.org", replyToEmail: "t@x.org", footerText: "F" }) === "Tomchei <t@x.org>",
);

// --- triggered registry ---------------------------------------------------------
check(
  "every triggered key has a complete coded default with the branding footer hook",
  TRIGGERED_KEYS.length === 4 &&
    TRIGGERED_KEYS.every((key) => {
      const defaults = TRIGGERED_DEFAULTS[key];
      return defaults.name.length > 0 && defaults.subject.length > 0 && defaults.bodyText.includes("{{footer}}");
    }),
);

// --- capture mode (S5 honesty) -----------------------------------------------------
check(
  "no RESEND_API_KEY → config reports the default base URL with a null key",
  (() => {
    const config = getResendConfig();
    return config.apiKey === null && config.baseUrl === "https://api.resend.com";
  })(),
);
check(
  "sendEmail without a key refuses with ResendNotConfiguredError (never a silent no-op)",
  await throwsNamed(() => sendEmail({ to: "a@b.org", subject: "s", text: "t", from: "f" }), "ResendNotConfiguredError"),
);
check("no TWILIO_* → SMS reports not configured", !isSmsConfigured());
check(
  "sendSms without keys refuses with SmsNotConfiguredError",
  await throwsNamed(() => sendSms({ to: "+15550000000", body: "b" }), "SmsNotConfiguredError"),
);
check(
  "an EMAIL outbox row captures instead of contacting a provider",
  (await deliverMessage({ channel: "EMAIL", toAddress: "cap@x.org", subject: "s", body: "b" })).captured &&
    (await deliverMessage({ channel: "EMAIL", toAddress: "cap@x.org", subject: "s", body: "b" })).providerId.startsWith("capture:email:"),
);
check(
  "an SMS outbox row captures instead of contacting a provider (G-021)",
  (await deliverMessage({ channel: "SMS", toAddress: "+15550000000", subject: null, body: "b" })).captured &&
    (await deliverMessage({ channel: "SMS", toAddress: "+15550000000", subject: null, body: "b" })).providerId.startsWith("capture:sms:"),
);
check(
  "the settings-tab mode readout is honestly capture/capture with no keys",
  (() => {
    const mode = currentDeliveryMode();
    return mode.email === "capture" && mode.sms === "capture";
  })(),
);

if (failures > 0) {
  console.error(`${failures} P11 unit check(s) failed`);
  process.exit(1);
}
console.log("P11 unit checks passed");
