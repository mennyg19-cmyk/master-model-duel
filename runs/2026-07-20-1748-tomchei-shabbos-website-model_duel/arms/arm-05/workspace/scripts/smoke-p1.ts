import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createDevSessionToken } from "../lib/dev-auth";
import { LOCAL_DATABASE_URL, runWithLocalDatabase, startLocalDatabase, stopLocalDatabase } from "./local-db";

const baseUrl = "http://localhost:3105";
const devAuthSecret = randomBytes(32).toString("hex");
const managerSession = {
  userId: "dev-manager",
  email: "manager@local.test",
  expiresAt: Date.now() + 5 * 60_000,
};
const staffSession = {
  userId: "dev-staff",
  email: "staff@local.test",
  expiresAt: Date.now() + 5 * 60_000,
};

process.env.DEV_AUTH_MODE = "true";
process.env.DEV_AUTH_SECRET = devAuthSecret;

async function assertStatus(response: Response, expected: number, check: string) {
  if (response.status !== expected) {
    throw new Error(`${check} expected ${expected}, received ${response.status}: ${await awaitResponseText(response)}`);
  }
}

async function awaitResponseText(response: Response) {
  return (await response.text()).slice(0, 300);
}

async function request(
  path: string,
  session?: typeof managerSession,
  body?: Record<string, unknown>,
  method = "GET",
) {
  const headers: Record<string, string> = { origin: baseUrl };
  if (session) headers["x-dev-session"] = createDevSessionToken(session);
  if (body) headers["content-type"] = "application/json";
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/`)).ok) return;
    } catch {
      // The development server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Development server did not start on port 3105.");
}

async function runSmoke() {
  await startLocalDatabase();
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  let server: ReturnType<typeof spawn> | undefined;

  try {
    await runWithLocalDatabase("prisma", ["migrate", "deploy"]);
    await runWithLocalDatabase("tsx", ["prisma/seed.ts"]);
    server = spawn(executable, ["next", "dev", "-p", "3105"], {
      env: {
        ...process.env,
        DATABASE_URL: LOCAL_DATABASE_URL,
        DEV_AUTH_MODE: "true",
        DEV_AUTH_SECRET: devAuthSecret,
      },
      stdio: "inherit",
    });
    await waitForServer();

    await assertStatus(await request("/"), 200, "S1");
    const health = await request("/api/health");
    await assertStatus(health, 200, "S2");
    const healthBody = await health.json() as { database: { ok: boolean } };
    if (!healthBody.database.ok) throw new Error("S2 health did not report PostgreSQL as ready.");

    await assertStatus(
      await request("/api/setup", managerSession, { displayName: "Smoke Manager" }, "POST"),
      201,
      "S4 first setup",
    );
    await assertStatus(
      await request("/api/setup", managerSession, { displayName: "Smoke Manager" }, "POST"),
      409,
      "S4 setup lock",
    );

    const invitedStaff = await request("/api/staff", managerSession, {
      displayName: "Smoke Staff",
      email: staffSession.email,
      clerkUserId: staffSession.userId,
      role: "STAFF",
    }, "POST");
    await assertStatus(invitedStaff, 201, "S3 staff invite");
    const staffBody = await invitedStaff.json() as { staffMember: { id: string; version: number } };

    await assertStatus(await request("/api/admin/security", staffSession), 403, "S3 permission gate");

    await assertStatus(
      await request(`/api/staff/${staffBody.staffMember.id}`, managerSession, {
        action: "update",
        version: staffBody.staffMember.version,
        role: "STAFF",
        overrides: { "audit.read": "DENY" },
      }, "PATCH"),
      200,
      "S5 role change",
    );
    await assertStatus(
      await request(`/api/staff/${staffBody.staffMember.id}`, managerSession, { action: "impersonate" }, "PATCH"),
      200,
      "S5 impersonation",
    );
    const audit = await request("/api/audit", managerSession);
    await assertStatus(audit, 200, "S5 audit");
    const auditBody = await audit.json() as { audits: Array<{ action: string }> };
    const actions = auditBody.audits.map((event) => event.action);
    if (!actions.includes("staff.role_changed") || !actions.includes("staff.impersonation_started")) {
      throw new Error("S5 audit records are incomplete.");
    }

    console.log("S1=200 S2=200 S3=403 S4=201_then_409 S5=role_change_and_impersonation_audited");
  } finally {
    server?.kill("SIGTERM");
    await stopLocalDatabase();
  }
}

void runSmoke().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
