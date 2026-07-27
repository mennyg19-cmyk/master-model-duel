import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ENV_VARIABLES, envSchema } from '../src/lib/env-spec';

const VALID_LOCAL_ENV = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:4104/tomchei?schema=public',
  APP_URL: 'http://127.0.0.1:3104',
  AUTH_PROVIDER: 'local',
  AUTH_SESSION_SECRET: 'Kf7pQx2LzR9vB4nT6wY1sJ3hD8mA5cE0',
  MEDIA_STORAGE: 'local',
  PAYMENT_PROVIDER: 'local',
  STRIPE_WEBHOOK_SECRET: 'Wh3Bq8zLp2Rv6Nt4Ys1Jd7Hm5Ac0Ef',
};

/** Everything a deployment that is not this laptop has to switch over. */
const HOSTED_OVERRIDES = {
  APP_URL: 'https://tomchei.example',
  AUTH_PROVIDER: 'clerk',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live',
  CLERK_SECRET_KEY: 'clerk-secret',
  MEDIA_STORAGE: 'blob',
  BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_token',
  PAYMENT_PROVIDER: 'stripe',
  STRIPE_SECRET_KEY: 'provider-secret',
  SHIPPING_PROVIDER: 'shippo',
  SHIPPO_API_TOKEN: 'carrier-token',
  MAPBOX_ACCESS_TOKEN: 'mapbox-token',
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 'mail-provider-key',
  SMS_PROVIDER: 'twilio',
  TWILIO_ACCOUNT_SID: 'text-provider-account',
  TWILIO_AUTH_TOKEN: 'text-provider-token',
  TWILIO_FROM_NUMBER: '+15550100',
  CRON_SECRET: 'Zx9Qw3Lm7Pv2Rt6Ys1Jd8Hn4',
};

function pathsRejectedBy(overrides: Record<string, string>): string[] {
  const parsed = envSchema.safeParse({ ...VALID_LOCAL_ENV, ...overrides });
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
}

test('a complete loopback development env validates', () => {
  assert.deepEqual(pathsRejectedBy({}), []);
});

test('the secret shipped in .env.example cannot boot the app', () => {
  const example = Object.fromEntries(ENV_VARIABLES.map((variable) => [variable.key, variable.example]));
  const parsed = envSchema.safeParse({ ...example, NODE_ENV: 'development' });

  assert.equal(parsed.success, false);
  assert.ok(
    !parsed.success && parsed.error.issues.some((issue) => issue.path[0] === 'AUTH_SESSION_SECRET'),
    'the placeholder secret must be rejected by name',
  );
});

test('a long but low-variety session secret is rejected', () => {
  assert.deepEqual(pathsRejectedBy({ AUTH_SESSION_SECRET: 'ababababababababababababababababab' }), [
    'AUTH_SESSION_SECRET',
  ]);
});

test('a placeholder long enough to pass the length floor is rejected on every bearer secret', () => {
  const placeholder = 'changeme-changeme-changeme';

  assert.deepEqual(pathsRejectedBy({ STRIPE_WEBHOOK_SECRET: placeholder }), [
    'STRIPE_WEBHOOK_SECRET',
  ]);
  assert.deepEqual(pathsRejectedBy({ CRON_SECRET: placeholder }), ['CRON_SECRET']);
});

test('the passwordless local provider is refused off this machine', () => {
  // Media storage and the payment stand-in follow the same loopback rule, so
  // both are switched over here to leave the auth rule as the only thing under
  // test.
  const hosted = { ...HOSTED_OVERRIDES, AUTH_PROVIDER: 'local' };

  assert.deepEqual(pathsRejectedBy({ ...hosted, APP_URL: 'https://staging.tomchei.example' }), [
    'AUTH_PROVIDER',
  ]);
  assert.deepEqual(pathsRejectedBy({ ...hosted, APP_URL: 'http://10.0.0.4:3104' }), [
    'AUTH_PROVIDER',
  ]);
});

test('local media storage is refused off this machine, and blob storage needs its token', () => {
  const hostedWithLocalMedia = { ...HOSTED_OVERRIDES, MEDIA_STORAGE: 'local' };

  assert.deepEqual(pathsRejectedBy(hostedWithLocalMedia), ['MEDIA_STORAGE']);
  assert.deepEqual(pathsRejectedBy({ ...HOSTED_OVERRIDES, BLOB_READ_WRITE_TOKEN: '' }), [
    'BLOB_READ_WRITE_TOKEN',
  ]);
});

/**
 * The stand-in takes no money, so a deployment that reaches real customers must
 * not be able to run it — and the signing secret is required in both modes,
 * because the loopback provider signs its own callbacks with it.
 */
test('the payment stand-in is loopback-only and the provider needs its keys', () => {
  assert.deepEqual(pathsRejectedBy({ ...HOSTED_OVERRIDES, PAYMENT_PROVIDER: 'local' }), [
    'PAYMENT_PROVIDER',
  ]);
  assert.deepEqual(pathsRejectedBy({ ...HOSTED_OVERRIDES, STRIPE_SECRET_KEY: '' }), [
    'STRIPE_SECRET_KEY',
  ]);
  assert.deepEqual(pathsRejectedBy({ STRIPE_WEBHOOK_SECRET: 'too-short' }), [
    'STRIPE_WEBHOOK_SECRET',
  ]);
});

/**
 * The offline shipping provider issues labels no carrier has heard of, and the
 * carrier account slots are optional on purpose: an org with no UPS account
 * simply never sees a UPS rate (R-183, R-184).
 */
test('the shipping stand-in is loopback-only and shippo needs its token', () => {
  assert.deepEqual(pathsRejectedBy({ ...HOSTED_OVERRIDES, SHIPPING_PROVIDER: 'local' }), [
    'SHIPPING_PROVIDER',
  ]);
  assert.deepEqual(pathsRejectedBy({ ...HOSTED_OVERRIDES, SHIPPO_API_TOKEN: '' }), [
    'SHIPPO_API_TOKEN',
  ]);
  assert.deepEqual(pathsRejectedBy({ ...HOSTED_OVERRIDES, SHIPPO_UPS_ACCOUNT_ID: '' }), []);
});

/**
 * Both of P9's new secrets are optional on this machine and required anywhere
 * else: the offline geocoder invents coordinates, and a missing cron secret is
 * a deployment whose sweepers silently never run.
 */
test('route planning and the sweepers need their secrets off this machine', () => {
  assert.deepEqual(pathsRejectedBy({ ...HOSTED_OVERRIDES, MAPBOX_ACCESS_TOKEN: '' }), [
    'MAPBOX_ACCESS_TOKEN',
  ]);
  assert.deepEqual(pathsRejectedBy({ ...HOSTED_OVERRIDES, CRON_SECRET: '' }), ['CRON_SECRET']);
  assert.deepEqual(pathsRejectedBy({ CRON_SECRET: 'too-short' }), ['CRON_SECRET']);
  assert.deepEqual(pathsRejectedBy({ MAPBOX_ACCESS_TOKEN: '', CRON_SECRET: '' }), []);
});

/**
 * Capturing mail is the stand-in with the quietest failure: a hosted
 * deployment left on it takes orders, queues every confirmation and posts none
 * of them while every screen reports the message as sent (R-088).
 */
test('captured mail and texts are loopback-only, and the providers need their keys', () => {
  assert.deepEqual(pathsRejectedBy({ ...HOSTED_OVERRIDES, EMAIL_PROVIDER: 'capture' }), [
    'EMAIL_PROVIDER',
  ]);
  assert.deepEqual(pathsRejectedBy({ ...HOSTED_OVERRIDES, SMS_PROVIDER: 'capture' }), [
    'SMS_PROVIDER',
  ]);
  assert.deepEqual(pathsRejectedBy({ ...HOSTED_OVERRIDES, RESEND_API_KEY: '' }), [
    'RESEND_API_KEY',
  ]);
  assert.deepEqual(pathsRejectedBy({ ...HOSTED_OVERRIDES, TWILIO_AUTH_TOKEN: '', TWILIO_FROM_NUMBER: '' }), [
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
  ]);
});

test('clerk still requires its keys', () => {
  assert.deepEqual(pathsRejectedBy({ AUTH_PROVIDER: 'clerk', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '', CLERK_SECRET_KEY: '' }), [
    'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    'CLERK_SECRET_KEY',
  ]);
});
