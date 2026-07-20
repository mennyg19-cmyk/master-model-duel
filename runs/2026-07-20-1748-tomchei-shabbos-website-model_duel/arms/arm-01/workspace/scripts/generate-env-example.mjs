import { writeFile } from "node:fs/promises";

const environmentExample = `# Required: PostgreSQL 15+ connection string
DATABASE_URL=postgresql://postgres:replace-me@127.0.0.1:4101/tomchei_p1?schema=public

# Required for Clerk-backed authentication outside local development
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_replace_me
CLERK_SECRET_KEY=sk_test_replace_me

# Optional bounded client-error ingestion token
CLIENT_ERROR_TOKEN=replace-with-a-random-value

# Required for signed newsletter preference and unsubscribe links
NEWSLETTER_HMAC_SECRET=replace-with-at-least-24-random-characters

# Required for production media uploads to Vercel Blob
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_replace_me

# Required for hosted Stripe Checkout and signed payment webhooks
STRIPE_SECRET_KEY=sk_test_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me

# Test/CI only. Never enable on preview, staging, or production deployments.
ENABLE_TEST_AUTH=false
`;

await writeFile(".env.example", environmentExample, "utf8");
console.log("Wrote .env.example");
