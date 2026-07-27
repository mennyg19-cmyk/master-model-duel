import { spawnSync } from "node:child_process";

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const outcome = spawnSync(executable, ["prisma", "validate"], {
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:4105/tomchei_shabbos",
  },
  stdio: "inherit",
});

process.exit(outcome.status ?? 1);
