// Concurrency smoke (G-024 groundwork): fire 10 versioned updates at one
// staff record holding the same version. Exactly one may win; the other nine
// must come back as 409 conflicts instead of silently overwriting.
//
// Standalone (empty DB): bootstraps its own manager + fixture via /api/setup.
// Driven: pass SMOKE_COOKIE (+ optional SMOKE_TARGET_ID / SMOKE_TARGET_VERSION)
// to reuse an existing manager session.
const BASE = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3106";

async function api(path, { method = "GET", cookie, body } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
}

async function bootstrapManagerCookie() {
  const response = await api("/api/setup", {
    method: "POST",
    body: { name: "Concurrency Manager", email: `concurrency-${Date.now()}@example.org` },
  });
  if (!response.ok) {
    throw new Error(`manager bootstrap failed: ${response.status}`);
  }
  // undici hides set-cookie from .get(); getSetCookie() is the supported API.
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  const sessionCookie = setCookies.map((value) => value.split(";")[0]).find((value) => value.startsWith("arm06_session="));
  if (!sessionCookie) {
    throw new Error("manager bootstrap did not return a session cookie");
  }
  return sessionCookie;
}

const cookie = process.env.SMOKE_COOKIE ?? (await bootstrapManagerCookie());

let fixtureId = process.env.SMOKE_TARGET_ID;
let fixtureVersion = Number(process.env.SMOKE_TARGET_VERSION);

if (!fixtureId) {
  const created = await api("/api/admin/staff", {
    method: "POST",
    cookie,
    body: { name: "Race Target", email: `race-${Date.now()}@example.org`, role: "STAFF" },
  });
  if (!created.ok) {
    throw new Error(`fixture create failed: ${created.status}`);
  }
  const { staff } = await created.json();
  fixtureId = staff.id;
  fixtureVersion = staff.version;
}

const attempts = await Promise.all(
  Array.from({ length: 10 }, (_, index) =>
    api(`/api/admin/staff/${fixtureId}`, {
      method: "PATCH",
      cookie,
      body: { version: fixtureVersion, role: index % 2 === 0 ? "MANAGER" : "DRIVER" },
    }).then((res) => res.status),
  ),
);

const wins = attempts.filter((status) => status === 200).length;
const conflicts = attempts.filter((status) => status === 409).length;
const others = attempts.filter((status) => status !== 200 && status !== 409);

const passed = wins === 1 && conflicts === 9 && others.length === 0;
console.log(JSON.stringify({ attempts, wins, conflicts, others: others.length, passed }, null, 2));

if (!passed) {
  console.error("concurrency-smoke: FAILED — expected 1 win + 9 conflicts");
  process.exit(1);
}
console.log("concurrency-smoke: ok (1 win, 9 conflicts reported)");
