import { z } from "zod";
import { ENV_SPEC } from "./env-spec";
import { isDevAuthBypassEnabled } from "./dev-auth";

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

// The bypass predicate lives in lib/dev-auth.ts (single source shared with
// middleware): hard-disabled on ANY Vercel deploy, and fail-closed unless
// APP_ENV=test — a deployed environment that forgets APP_ENV gets
// "production" and the dev seam stays shut.
export const isProductionDeploy = process.env.VERCEL_ENV === "production";
export const isDevAuthBypass = isDevAuthBypassEnabled();
