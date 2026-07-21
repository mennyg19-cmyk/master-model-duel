import { db } from "../src/lib/db";
import { SETUP_LOCK_KEY } from "../src/lib/constants";

async function main() {
  await db.impersonationSession.deleteMany();
  await db.auditLog.deleteMany();
  await db.permissionOverride.deleteMany();
  await db.staffUser.deleteMany();
  await db.appSetting.deleteMany({ where: { key: SETUP_LOCK_KEY } });
  console.log(JSON.stringify({ ok: true, cleared: true }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
