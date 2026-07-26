import { z } from 'zod';

/**
 * Single source of truth for environment configuration: the Zod schema and the
 * `.env.example` generator both read this list, so they cannot drift apart.
 */
export type EnvVariableSpec = {
  key: string;
  description: string;
  example: string;
  secret?: boolean;
};

/** Shipped in `.env.example` and rejected by validation, so nobody can boot on it. */
const PLACEHOLDER_SESSION_SECRET = 'change-me-to-a-32-character-random-string';

const MIN_DISTINCT_SECRET_CHARACTERS = 12;
const WEAK_SECRET_PATTERN = /change[-_ ]?me|placeholder|example|insecure|^0+$/i;

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * A 32-character string of one repeated word passes a length check and still
 * signs every session cookie, so length alone is not a secret.
 */
function isWeakSecret(secret: string): boolean {
  if (secret === PLACEHOLDER_SESSION_SECRET) return true;
  if (WEAK_SECRET_PATTERN.test(secret)) return true;
  return new Set(secret).size < MIN_DISTINCT_SECRET_CHARACTERS;
}

/** The passwordless local provider is only defensible when the app is this machine. */
export function isLoopbackUrl(candidate: string): boolean {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(candidate).hostname);
  } catch {
    return false;
  }
}

export const ENV_VARIABLES: EnvVariableSpec[] = [
  {
    key: 'DATABASE_URL',
    description: 'Postgres connection string. Local dev uses the embedded cluster on port 4104.',
    example: 'postgresql://postgres:postgres@127.0.0.1:4104/tomchei?schema=public',
    secret: true,
  },
  {
    key: 'APP_URL',
    description: 'Public base URL of this deployment. Used for absolute links in emails and print routes.',
    example: 'http://127.0.0.1:3104',
  },
  {
    key: 'AUTH_PROVIDER',
    description:
      'clerk = hosted Clerk identity. local = passwordless signed-cookie identity for offline dev ' +
      'and CI; it is rejected unless APP_URL points at this machine, and it refuses to open a ' +
      'session in a production runtime.',
    example: 'local',
  },
  {
    key: 'AUTH_SESSION_SECRET',
    description:
      'HMAC key for local session and impersonation cookies. At least 32 characters of real ' +
      'randomness: generate with `openssl rand -base64 48`. The placeholder below is rejected on ' +
      'purpose, so a deployment cannot boot with a secret an attacker can read in this repository.',
    example: PLACEHOLDER_SESSION_SECRET,
    secret: true,
  },
  {
    key: 'TRUST_PROXY_HEADERS',
    description:
      'true only when a proxy you control rewrites x-forwarded-for. While false, audit rows record ' +
      'no client IP rather than one the caller can forge.',
    example: 'false',
  },
  {
    key: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    description: 'Clerk publishable key. Required only when AUTH_PROVIDER=clerk.',
    example: '',
  },
  {
    key: 'CLERK_SECRET_KEY',
    description: 'Clerk secret key. Required only when AUTH_PROVIDER=clerk.',
    example: '',
    secret: true,
  },
];

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL must be a Postgres connection string'),
  APP_URL: z.url('APP_URL must be an absolute URL, for example http://127.0.0.1:3104'),
  AUTH_PROVIDER: z.enum(['clerk', 'local']),
  AUTH_SESSION_SECRET: z.string().min(32, 'AUTH_SESSION_SECRET must be at least 32 characters'),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
  TRUST_PROXY_HEADERS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export const envSchema = baseSchema.superRefine((env, ctx) => {
  if (isWeakSecret(env.AUTH_SESSION_SECRET)) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_SESSION_SECRET'],
      message:
        'AUTH_SESSION_SECRET is a known placeholder or has too little variety to be a real key. ' +
        'Generate one with `openssl rand -base64 48`',
    });
  }

  if (env.AUTH_PROVIDER === 'local') {
    // NODE_ENV is not a trust boundary — a staging box happily runs with
    // NODE_ENV=development, and `next build` sets production even for a local
    // deployment. Where the app answers is the honest signal: anything reachable
    // off this machine needs Clerk. `startLocalSession` adds the runtime half.
    if (!isLoopbackUrl(env.APP_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_PROVIDER'],
        message:
          `AUTH_PROVIDER=local is only allowed when APP_URL is a loopback address, but APP_URL is ` +
          `${env.APP_URL}. Deploy with AUTH_PROVIDER=clerk`,
      });
    }

    return;
  }

  for (const key of ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'] as const) {
    if (!env[key]) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} is required when AUTH_PROVIDER=clerk, but it was empty`,
      });
    }
  }
});

export type Env = z.infer<typeof baseSchema>;

export function renderEnvExample(): string {
  const lines = [
    '# Generated by `npm run env:example` from src/lib/env-spec.ts. Do not edit by hand.',
    '# Copy to .env and fill in real values. Never commit .env.',
    '',
  ];

  for (const variable of ENV_VARIABLES) {
    lines.push(`# ${variable.description}`);
    if (variable.secret) lines.push('# Secret: rotate immediately if it ever leaves this machine.');
    lines.push(`${variable.key}=${variable.example}`, '');
  }

  return lines.join('\n');
}
