import 'dotenv/config';

import { defineConfig } from 'prisma/config';

export default defineConfig({
  // A folder, not a file: the domain is split by concern (catalog, orders,
  // fulfillment, inventory) instead of living in one 700-line schema.
  schema: 'prisma/schema',
  migrations: {
    // Stated explicitly: with a schema folder Prisma otherwise looks for
    // migrations inside it, and the P1 history already lives here.
    path: 'prisma/migrations',
    // `server-only` guards the modules the seed reuses, so it needs the same
    // module resolution condition the Next.js server uses.
    seed: 'node --import tsx --conditions=react-server prisma/seed.ts',
  },
});
