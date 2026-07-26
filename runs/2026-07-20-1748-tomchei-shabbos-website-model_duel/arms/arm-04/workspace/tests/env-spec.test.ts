import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ENV_VARIABLES, envSchema } from '../src/lib/env-spec';

const VALID_LOCAL_ENV = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:4104/tomchei?schema=public',
  APP_URL: 'http://127.0.0.1:3104',
  AUTH_PROVIDER: 'local',
  AUTH_SESSION_SECRET: 'Kf7pQx2LzR9vB4nT6wY1sJ3hD8mA5cE0',
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

test('the passwordless local provider is refused off this machine', () => {
  assert.deepEqual(pathsRejectedBy({ APP_URL: 'https://staging.tomchei.example' }), ['AUTH_PROVIDER']);
  assert.deepEqual(pathsRejectedBy({ APP_URL: 'http://10.0.0.4:3104' }), ['AUTH_PROVIDER']);
});

test('clerk still requires its keys', () => {
  assert.deepEqual(pathsRejectedBy({ AUTH_PROVIDER: 'clerk' }), [
    'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    'CLERK_SECRET_KEY',
  ]);
});
