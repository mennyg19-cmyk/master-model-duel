import { z } from "zod";
import { ENV_SPEC } from "./env-spec";

const shape = Object.fromEntries(ENV_SPEC.map((entry) => [entry.key, entry.schema]));
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
export const isDevAuthBypass = env.DEV_AUTH_BYPASS === "true";
