import { writeFile } from "node:fs/promises";

const environmentExample = `# Required: PostgreSQL 15+ connection string
DATABASE_URL=postgresql://postgres:replace-me@127.0.0.1:4101/tomchei_p1?schema=public

# Required for Clerk-backed authentication outside local development
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_replace_me
CLERK_SECRET_KEY=sk_test_replace_me

# Optional bounded client-error ingestion token
CLIENT_ERROR_TOKEN=replace-with-a-random-value
`;

await writeFile(".env.example", environmentExample, "utf8");
console.log("Wrote .env.example");
