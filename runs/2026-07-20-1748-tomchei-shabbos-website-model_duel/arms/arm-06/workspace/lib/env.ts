import { z } from "zod";
import { ENV_SPEC } from "./env-spec";

// Mapped type keeps per-key optionality (Object.fromEntries alone would
// collapse every key to the union of all schemas, making them all optional).
type EnvShape = { [E in (typeof ENV_SPEC)[number] as E["key"]]: E["schema"] };
const shape = Object.fromEntries(ENV_SPEC.map((entry) => [entry.key, entry.schema])) as EnvShape;
const envSchema = z.object(shape);

export type AppEnv = z.infer<typeof envSchema>;

function loadEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Missing or invalid environment configuration:\n${problems}\nSee .env.example.`,
    );
  }
  return parsed.data;
}

export const env = loadEnv();

// Dev-auth is hard-disabled on ANY Vercel deploy no matter what the flag
// says: production is obvious, but a preview deploy is also a public URL, so
// a leaked DEV_AUTH_BYPASS=true must never open either one. The Vercel guard
// alone is platform-specific, though — a container or CI host never sets
// VERCEL_ENV, so the fail-closed, platform-agnostic gate is the APP_ENV
// class itself: only an explicit APP_ENV=test (default: production) lets the
// bypass exist at all. A deployed environment that forgets APP_ENV gets
// "production" and the dev seam stays shut.
const vercelEnv = process.env.VERCEL_ENV;
export const isProductionDeploy = vercelEnv === "production";
export const isDevAuthBypass =
  env.DEV_AUTH_BYPASS === "true" && env.APP_ENV === "test" && vercelEnv !== "production" && vercelEnv !== "preview";
