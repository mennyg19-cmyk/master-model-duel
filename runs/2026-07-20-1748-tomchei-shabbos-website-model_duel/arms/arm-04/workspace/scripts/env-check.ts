import { envSchema } from '../src/lib/env-spec';

/**
 * The same validation the app runs on boot, callable from CI and from the smoke
 * harness so "a bad env stops the app" is something we can demonstrate rather
 * than assert.
 */
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Environment configuration is invalid, so the app refuses to start.');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  process.exit(1);
}

console.log(`Environment OK (AUTH_PROVIDER=${parsed.data.AUTH_PROVIDER}).`);
