const base = process.env.APP_URL || "http://127.0.0.1:3103";

async function main() {
  const before = await fetch(`${base}/api/setup`).then((r) => r.json());
  console.log("before", before);

  const create = await fetch(`${base}/api/setup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "dev_user_id=dev_manager_1",
    },
    body: JSON.stringify({
      email: "manager@tomchei.local",
      displayName: "First Manager",
    }),
  });
  console.log("create", create.status, await create.json());

  const after = await fetch(`${base}/api/setup`).then((r) => r.json());
  console.log("after", after);

  const second = await fetch(`${base}/api/setup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "dev_user_id=dev_manager_1",
    },
    body: JSON.stringify({
      email: "other@tomchei.local",
      displayName: "Nope",
    }),
  });
  console.log("second", second.status, await second.json());

  if (!after.locked || second.status !== 409) {
    process.exit(1);
  }
  console.log("bootstrap smoke ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
