const base = process.env.APP_URL || "http://127.0.0.1:3103";

async function req(pathname, init = {}) {
  const res = await fetch(`${base}${pathname}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json, headers: res.headers };
}

function cookieHeader(userId) {
  return { cookie: `dev_user_id=${userId}` };
}

async function main() {
  const evidence = [];

  const home = await req("/");
  evidence.push({ id: "S1", check: "GET /", status: home.status, pass: home.status === 200 });

  const health = await req("/api/health");
  evidence.push({
    id: "S2",
    check: "GET /api/health",
    status: health.status,
    body: health.json,
    pass: health.status === 200 && health.json?.ok === true && health.json?.db === "ok",
  });

  const staffDenied = await req("/api/admin/gated", {
    headers: cookieHeader("dev_staff_1"),
  });
  evidence.push({
    id: "S3",
    check: "Staff without staff.manage → 403",
    status: staffDenied.status,
    body: staffDenied.json,
    pass: staffDenied.status === 403,
  });

  // Bootstrap lock: seeded DB should report locked; re-POST must fail.
  const setupStatus = await req("/api/setup");
  const setupPost = await req("/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({ email: "another@tomchei.local", displayName: "Should Fail" }),
  });
  evidence.push({
    id: "S4",
    check: "Setup locked after bootstrap",
    status: setupPost.status,
    setup: setupStatus.json,
    body: setupPost.json,
    pass: setupStatus.json?.locked === true && setupPost.status === 409,
  });

  // Role change + impersonation audit
  const staffList = await req("/api/staff", { headers: cookieHeader("dev_manager_1") });
  const driver = staffList.json?.staff?.find((row) => row.role === "DRIVER");
  let roleAuditOk = false;
  let impersonateAuditOk = false;
  if (driver) {
    const roleChange = await req("/api/staff", {
      method: "PATCH",
      headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
      body: JSON.stringify({
        intent: "role",
        staffUserId: driver.id,
        role: "DRIVER",
        expectedVersion: driver.version,
      }),
    });
    const staffTarget = staffList.json.staff.find((row) => row.email === "staff@tomchei.local");
    const impersonate = await req("/api/impersonate", {
      method: "POST",
      headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
      body: JSON.stringify({ targetStaffUserId: staffTarget.id }),
    });
    const audit = await req("/api/audit", { headers: cookieHeader("dev_manager_1") });
    const actions = (audit.json?.entries || []).map((entry) => entry.action);
    roleAuditOk = roleChange.status === 200 && actions.includes("STAFF_ROLE_CHANGED");
    impersonateAuditOk = impersonate.status === 200 && actions.includes("IMPERSONATION_STARTED");
    // stop impersonation
    await req("/api/impersonate", {
      method: "DELETE",
      headers: cookieHeader("dev_manager_1"),
    });
  }
  evidence.push({
    id: "S5",
    check: "Audit has role change + impersonation",
    pass: roleAuditOk && impersonateAuditOk,
    roleAuditOk,
    impersonateAuditOk,
  });

  const managerGated = await req("/api/admin/gated", {
    headers: cookieHeader("dev_manager_1"),
  });
  evidence.push({
    id: "S3b",
    check: "Manager passes gated route",
    status: managerGated.status,
    pass: managerGated.status === 200,
  });

  const failed = evidence.filter((row) => !row.pass);
  const report = {
    base,
    at: new Date().toISOString(),
    pass: failed.length === 0,
    evidence,
  };
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
