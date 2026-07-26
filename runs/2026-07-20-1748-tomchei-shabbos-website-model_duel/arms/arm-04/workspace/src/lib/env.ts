import 'server-only';

import { type Env, envSchema } from './env-spec';

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Environment configuration is invalid, so the app refuses to start.\n${problems}\n` +
        'Expected every variable listed in .env.example to be present and valid.',
    );
  }

  return parsed.data;
}

export const env = loadEnv();
