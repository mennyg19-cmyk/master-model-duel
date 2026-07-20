type ServerEnvironment = {
  DATABASE_URL: string;
  CLERK_SECRET_KEY?: string;
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  CLIENT_ERROR_TOKEN?: string;
  SHIPPO_API_TOKEN?: string;
  SHIPPO_FEDEX_ACCOUNT_ID?: string;
  SHIPPO_UPS_ACCOUNT_ID?: string;
};

function requireEnvironmentValue(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env and set it before starting the app.`);
  }
  return value;
}

export function readServerEnvironment(): ServerEnvironment {
  return {
    DATABASE_URL: requireEnvironmentValue("DATABASE_URL"),
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    CLIENT_ERROR_TOKEN: process.env.CLIENT_ERROR_TOKEN,
    SHIPPO_API_TOKEN: process.env.SHIPPO_API_TOKEN,
    SHIPPO_FEDEX_ACCOUNT_ID: process.env.SHIPPO_FEDEX_ACCOUNT_ID,
    SHIPPO_UPS_ACCOUNT_ID: process.env.SHIPPO_UPS_ACCOUNT_ID,
  };
}

export function isClerkConfigured() {
  return Boolean(
    process.env.CLERK_SECRET_KEY &&
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );
}
