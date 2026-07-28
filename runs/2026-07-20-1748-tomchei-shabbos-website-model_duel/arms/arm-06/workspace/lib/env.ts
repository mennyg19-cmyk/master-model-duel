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

// Dev-auth is hard-disabled on a real Vercel production deploy no matter what
// the flag says — a leaked DEV_AUTH_BYPASS=true must never open prod. Local
// `next start` sets NODE_ENV=production too, so the deploy platform's own
// signal is the guard, not NODE_ENV.
export const isProductionDeploy = process.env.VERCEL_ENV === "production";
export const isDevAuthBypass = env.DEV_AUTH_BYPASS === "true" && !isProductionDeploy;
