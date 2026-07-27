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
const MIN_WEBHOOK_SECRET_LENGTH = 24;
const MIN_CRON_SECRET_LENGTH = 24;
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
    key: 'MEDIA_STORAGE',
    description:
      'blob = Vercel Blob, the deployment target for catalog photos. local = write them under ' +
      'public/uploads for offline development and CI; it is rejected unless APP_URL points at ' +
      'this machine, because a hosted filesystem is read-only and per-instance.',
    example: 'local',
  },
  {
    key: 'BLOB_READ_WRITE_TOKEN',
    description: 'Vercel Blob read-write token. Required only when MEDIA_STORAGE=blob.',
    example: '',
    secret: true,
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
  {
    key: 'PAYMENT_PROVIDER',
    description:
      'stripe = hosted Stripe Checkout, the deployment target. local = a loopback stand-in that ' +
      'hosts the payment page itself and signs its own callbacks with the same webhook secret, so ' +
      'offline development and CI run the real signature, idempotency and refund code. It is ' +
      'rejected unless APP_URL points at this machine, because it takes no money.',
    example: 'local',
  },
  {
    key: 'STRIPE_SECRET_KEY',
    description: 'Stripe secret key. Required only when PAYMENT_PROVIDER=stripe.',
    example: '',
    secret: true,
  },
  {
    key: 'STRIPE_WEBHOOK_SECRET',
    description:
      'Signing secret for the /api/webhooks/stripe endpoint. Required in both modes: it is what ' +
      'makes a webhook authentic, and the loopback provider signs with it too so the verification ' +
      'path is never skipped in development.',
    example: '',
    secret: true,
  },
  {
    key: 'SHIPPING_PROVIDER',
    description:
      'shippo = live carrier rates and labels, the deployment target. local = an offline ' +
      'stand-in that prices and issues labels on this machine so rate shopping, the margin ' +
      'engine and voiding all run for real in development and CI. It is rejected unless APP_URL ' +
      'points at this machine, because its labels do not exist at any carrier.',
    example: 'local',
  },
  {
    key: 'SHIPPO_API_TOKEN',
    description: 'Shippo API token. Required only when SHIPPING_PROVIDER=shippo.',
    example: '',
    secret: true,
  },
  {
    key: 'SHIPPO_FEDEX_ACCOUNT_ID',
    description:
      "Shippo carrier account id for the organization's own FedEx account. Leave empty to quote " +
      'only the carriers that are configured; an empty slot means that carrier is not offered. ' +
      "It is not a password, but it names and bills the organization's contract, so it is handled " +
      'as a secret rather than as configuration.',
    example: '',
    secret: true,
  },
  {
    key: 'SHIPPO_UPS_ACCOUNT_ID',
    description:
      "Shippo carrier account id for the organization's own UPS account. Same rule as FedEx: " +
      'empty means UPS is not quoted and never wins the rate comparison.',
    example: '',
    secret: true,
  },
  {
    key: 'MAPBOX_ACCESS_TOKEN',
    description:
      'Mapbox token used to turn a delivery address into coordinates so route stops can be ' +
      'ordered. Empty is allowed only on this machine, where an offline stand-in places ' +
      'addresses instead; a deployment that plans real routes must set it.',
    example: '',
    secret: true,
  },
  {
    key: 'CRON_SECRET',
    description:
      'Bearer secret the scheduled-job endpoints require. Empty means every cron endpoint ' +
      'refuses every request, which is the safe reading of "not configured" — so a hosted ' +
      'deployment has to set it or its sweepers never run. At least 24 characters.',
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
  MEDIA_STORAGE: z.enum(['blob', 'local']),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
  PAYMENT_PROVIDER: z.enum(['stripe', 'local']),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .min(MIN_WEBHOOK_SECRET_LENGTH, `STRIPE_WEBHOOK_SECRET must be at least ${MIN_WEBHOOK_SECRET_LENGTH} characters`),
  SHIPPING_PROVIDER: z.enum(['shippo', 'local']).default('local'),
  SHIPPO_API_TOKEN: z.string().optional(),
  SHIPPO_FEDEX_ACCOUNT_ID: z.string().optional(),
  SHIPPO_UPS_ACCOUNT_ID: z.string().optional(),
  MAPBOX_ACCESS_TOKEN: z.string().optional(),
  CRON_SECRET: z.string().optional(),
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

  if (env.MEDIA_STORAGE === 'blob' && !env.BLOB_READ_WRITE_TOKEN) {
    ctx.addIssue({
      code: 'custom',
      path: ['BLOB_READ_WRITE_TOKEN'],
      message: 'BLOB_READ_WRITE_TOKEN is required when MEDIA_STORAGE=blob, but it was empty',
    });
  }

  // Same loopback rule as the local auth provider, for the same reason: a
  // hosted deployment has a read-only, per-instance filesystem, so a photo
  // written there is lost on the next request.
  if (env.MEDIA_STORAGE === 'local' && !isLoopbackUrl(env.APP_URL)) {
    ctx.addIssue({
      code: 'custom',
      path: ['MEDIA_STORAGE'],
      message:
        `MEDIA_STORAGE=local is only allowed when APP_URL is a loopback address, but APP_URL is ` +
        `${env.APP_URL}. Deploy with MEDIA_STORAGE=blob`,
    });
  }

  if (env.PAYMENT_PROVIDER === 'stripe' && !env.STRIPE_SECRET_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['STRIPE_SECRET_KEY'],
      message: 'STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe, but it was empty',
    });
  }

  // Same loopback rule as the local auth provider: a payment page that takes no
  // money must never be reachable by a customer who thinks it does.
  if (env.PAYMENT_PROVIDER === 'local' && !isLoopbackUrl(env.APP_URL)) {
    ctx.addIssue({
      code: 'custom',
      path: ['PAYMENT_PROVIDER'],
      message:
        `PAYMENT_PROVIDER=local is only allowed when APP_URL is a loopback address, but APP_URL is ` +
        `${env.APP_URL}. Deploy with PAYMENT_PROVIDER=stripe`,
    });
  }

  if (env.SHIPPING_PROVIDER === 'shippo' && !env.SHIPPO_API_TOKEN) {
    ctx.addIssue({
      code: 'custom',
      path: ['SHIPPO_API_TOKEN'],
      message: 'SHIPPO_API_TOKEN is required when SHIPPING_PROVIDER=shippo, but it was empty',
    });
  }

  // Same loopback rule as the local payment provider: this one issues labels no
  // carrier has heard of, so a real customer must never be quoted by it.
  if (env.SHIPPING_PROVIDER === 'local' && !isLoopbackUrl(env.APP_URL)) {
    ctx.addIssue({
      code: 'custom',
      path: ['SHIPPING_PROVIDER'],
      message:
        `SHIPPING_PROVIDER=local is only allowed when APP_URL is a loopback address, but APP_URL is ` +
        `${env.APP_URL}. Deploy with SHIPPING_PROVIDER=shippo`,
    });
  }

  // Same loopback rule again, for the weakest of the stand-ins: made-up
  // coordinates plan a van's afternoon, and off this machine that is a real
  // driver sent to the wrong end of town.
  if (!env.MAPBOX_ACCESS_TOKEN && !isLoopbackUrl(env.APP_URL)) {
    ctx.addIssue({
      code: 'custom',
      path: ['MAPBOX_ACCESS_TOKEN'],
      message:
        'MAPBOX_ACCESS_TOKEN is required unless APP_URL is a loopback address, where an ' +
        'offline stand-in places addresses instead',
    });
  }

  if (env.CRON_SECRET !== undefined && env.CRON_SECRET !== '' && env.CRON_SECRET.length < MIN_CRON_SECRET_LENGTH) {
    ctx.addIssue({
      code: 'custom',
      path: ['CRON_SECRET'],
      message: `CRON_SECRET must be at least ${MIN_CRON_SECRET_LENGTH} characters when it is set`,
    });
  }

  // A deployment with no cron secret has no working sweepers: pickups never
  // expire and no payment reminder is ever sent. On this machine that is a
  // choice; anywhere else it is a silent outage.
  if (!env.CRON_SECRET && !isLoopbackUrl(env.APP_URL)) {
    ctx.addIssue({
      code: 'custom',
      path: ['CRON_SECRET'],
      message:
        'CRON_SECRET is required unless APP_URL is a loopback address: without it every ' +
        'scheduled-job endpoint refuses every request',
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
