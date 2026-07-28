import EmbeddedPostgres from "embedded-postgres";
import { mkdirSync } from "node:fs";

// Embedded Postgres bound to port 4106 (per-arm db port). Data persists in
// .pgdata so restarts keep the migrated schema.
const pg = new EmbeddedPostgres({
  databaseDir: "./.pgdata",
  user: "postgres",
  password: "postgres",
  port: 4106,
  persistent: true,
});

mkdirSync(".pgdata", { recursive: true });

await pg.initialise();
await pg.start();

try {
  await pg.createDatabase("app");
  console.log("embedded-postgres: created database 'app'");
} catch (error) {
  if (!/already exists/i.test(String(error))) throw error;
  console.log("embedded-postgres: database 'app' already exists");
}

console.log("embedded-postgres: listening on 127.0.0.1:4106");

process.on("SIGINT", async () => {
  await pg.stop();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await pg.stop();
  process.exit(0);
});

setInterval(() => {}, 1 << 30);
