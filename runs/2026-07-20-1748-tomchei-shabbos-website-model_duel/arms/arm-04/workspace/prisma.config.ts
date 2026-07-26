import 'dotenv/config';

import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    // `server-only` guards the modules the seed reuses, so it needs the same
    // module resolution condition the Next.js server uses.
    seed: 'node --import tsx --conditions=react-server prisma/seed.ts',
  },
});
