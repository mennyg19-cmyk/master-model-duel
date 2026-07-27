import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
});

export function isClerkConfigured() {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secretKey = process.env.CLERK_SECRET_KEY;
  return Boolean(
    publishableKey?.startsWith("pk_")
      && secretKey?.startsWith("sk_")
      && !publishableKey.includes("replace_me")
      && !secretKey.includes("replace_me"),
  );
}

export function requireProductionEnvironment() {
  const parsed = environmentSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Missing or invalid required environment: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  return parsed.data;
}
