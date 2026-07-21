import { z } from "zod";

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    WEB_PORT: z.string().default("3103"),
    // Default fail-closed: production paths require Clerk unless AUTH_MODE=dev is set explicitly.
    AUTH_MODE: z.enum(["clerk", "dev"]).default("clerk"),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
    CLERK_SECRET_KEY: z.string().optional(),
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string().default("/sign-in"),
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: z.string().default("/sign-up"),
    DEV_MANAGER_USER_ID: z.string().optional(),
    DEV_STAFF_USER_ID: z.string().optional(),
    DEV_DRIVER_USER_ID: z.string().optional(),
    DEV_CUSTOMER_USER_ID: z.string().optional(),
    DEV_ACTING_USER_ID: z.string().optional(),
    APP_URL: z.string().url().default("http://127.0.0.1:3103"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** Explicit opt-in for destructive test-ops (wipe/reseed/dress). Also allowed when AUTH_MODE=dev. */
    IS_TEST_ENV: z
      .enum(["true", "false", "1", "0"])
      .optional()
      .transform((v) => v === "true" || v === "1"),
  })
  .superRefine((value, ctx) => {
    if (value.AUTH_MODE === "clerk") {
      if (!value.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"],
          message: "Clerk publishable key missing or invalid (expected pk_…)",
        });
      }
      if (!value.CLERK_SECRET_KEY?.startsWith("sk_")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CLERK_SECRET_KEY"],
          message: "Clerk secret key missing or invalid (expected sk_…)",
        });
      }
    }
    if (value.AUTH_MODE === "dev") {
      for (const key of [
        "DEV_MANAGER_USER_ID",
        "DEV_STAFF_USER_ID",
        "DEV_DRIVER_USER_ID",
      ] as const) {
        if (!value[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when AUTH_MODE=dev`,
          });
        }
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache() {
  cached = null;
}
