# P1 Security Review — arm-05 (blind)

**Phase:** P1 — Foundation, identity, roles, permissions, staff tooling
**Scope:** trust boundaries, auth, secrets, IDOR, injection. Findings only — no fixes.
**Evidence base:** `arms/arm-05/workspace/` (app routes, lib, prisma, tests, scratch smoke).

## Summary counts

- Blockers: 6
- Major: 7
- Minor: 5

---

## Blockers

### B1 — All staff-management API routes are unauthenticated

**Location:** `app/api/staff/route.ts` (GET, POST), `app/api/staff/[staffId]/route.ts` (PATCH), `app/api/audit/route.ts` (GET), `app/api/setup/route.ts` (POST), `app/api/admin/security/route.ts` (GET)
**Claim:** None of the staff-management or audit endpoints verify a Clerk session or any other authenticated identity before reading or mutating staff records, audit logs, or the bootstrap lock.
**Evidence:** `proxy.ts` matcher is `["/admin/:path*", "/api/admin/:path*"]` only — it does not cover `/api/staff`, `/api/staff/[staffId]`, `/api/audit`, or `/api/setup`. Even when Clerk is configured, the middleware never runs on these routes. The route handlers themselves call directly into `staff-store` with no `auth()`/`getAuth()` check. `smoke-p1.ts` proves this: every protected operation succeeds with bare `fetch()` and no auth header.

### B2 — Identity is spoofable via `?actor=<email>` query parameter

**Location:** `app/api/admin/security/route.ts:4-9`
**Claim:** The only "authorization" check in the entire arm reads the actor's email from a query string and trusts it. Any caller can claim any staff identity by passing `?actor=manager@…`.
**Evidence:**
```4:9:app/api/admin/security/route.ts
export function GET(request: Request) {
  const actor = new URL(request.url).searchParams.get("actor");
  const staffMember = listStaff().find((candidate) => candidate.email === actor);
  if (!requirePermission(staffMember?.id, "audit.read")) {
    return NextResponse.json({ error: "You do not have permission to view the security audit." }, { status: 403 });
  }
  return NextResponse.json({ auditsAvailable: true });
}
```
The "permission gate" demonstrated by smoke S3 is therefore advisory only; an attacker passes `?actor=<manager-email>` and is admitted.

### B3 — Unauthenticated privilege escalation: anyone can invite a MANAGER

**Location:** `app/api/staff/route.ts:16-23`
**Claim:** `POST /api/staff` accepts `role: "MANAGER"` with no caller authentication or `staff.manage` permission check. Any network caller can create a Manager account.
**Evidence:** The handler validates the body with Zod and calls `addStaff(...)` directly. There is no `requirePermission(..., "staff.manage")` gate. The role enum permits `"MANAGER"`. Combined with B1, this is remote privilege escalation to the highest role.

### B4 — Unauthenticated role/override mutation on any staff record (IDOR)

**Location:** `app/api/staff/[staffId]/route.ts:13-43`
**Claim:** `PATCH /api/staff/[staffId]` lets any caller change any staff member's role and per-permission overrides, revoke any staff member, or start impersonation — purely by supplying the `staffId` in the path. No auth, no ownership check, no `staff.manage` permission gate.
**Evidence:**
```13:43:app/api/staff/[staffId]/route.ts
export async function PATCH(
  request: Request,
  context: { params: Promise<{ staffId: string }> },
) {
  const { staffId } = await context.params;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid staff update." }, { status: 400 });

  if (parsed.data.action === "revoke") {
    return revokeStaff(staffId)
      ? NextResponse.json({ message: "Staff access revoked." })
      : NextResponse.json({ error: "Staff account was not found." }, { status: 404 });
  }
  if (parsed.data.action === "impersonate") {
    return startImpersonation(staffId)
      ? NextResponse.json({ message: "Impersonation session started and audited." })
      : NextResponse.json({ error: "Only active staff can be impersonated." }, { status: 409 });
  }

  if (parsed.data.version === undefined || !parsed.data.role || !parsed.data.overrides) {
    return NextResponse.json({ error: "A version, role, and overrides are required." }, { status: 400 });
  }
  const outcome = updateStaff(
    staffId,
    parsed.data.version,
    { role: parsed.data.role, overrides: parsed.data.overrides as Partial<Record<Permission, "GRANT" | "DENY">> },
  );
```
The `staffId` is caller-supplied; no actor is identified; no permission is checked. Classic IDOR + privilege escalation.

### B5 — Unauthenticated audit log disclosure

**Location:** `app/api/audit/route.ts:4-6`
**Claim:** `GET /api/audit` returns the entire security audit trail (bootstrap, role changes, revocations, impersonations, staff emails) to any caller with no authentication or `audit.read` permission check.
**Evidence:**
```4:6:app/api/audit/route.ts
export function GET() {
  return NextResponse.json({ audits: listAudits() });
}
```
No `requirePermission(..., "audit.read")` gate, despite the permission existing in `lib/permissions.ts`. Staff PII (emails) and security event history are exposed to the public.

### B6 — Unauthenticated bootstrap: anyone can create the first Manager

**Location:** `app/api/setup/route.ts:15-22`, `lib/staff-store.ts:51-66`
**Claim:** `POST /api/setup` is unauthenticated and, until the in-memory `firstManagerCreated` flag flips, any network caller can create the bootstrap Manager. There is no rate limit, no token, and no IP allowlist.
**Evidence:** The handler validates the body and calls `createFirstManager(...)`. The only protection is `if (state.firstManagerCreated) return { ok: false, ... }` — an in-memory flag (see B-major below for persistence problem). The smoke script demonstrates the endpoint is publicly callable. The plan (R-010/R-130) requires a first-run setup lockout; the lockout is non-functional against an attacker who reaches the endpoint before the legitimate operator.

---

## Major

### M1 — Clerk middleware fails open when env vars are missing

**Location:** `proxy.ts:5-7`, `lib/env.ts:9-11`
**Claim:** When `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` or `CLERK_SECRET_KEY` are absent, the middleware degrades to `() => NextResponse.next()` — i.e. allow-all. A misconfigured or partially-deployed environment silently runs with no auth rather than failing closed.
**Evidence:**
```5:7:proxy.ts
const middleware = isClerkConfigured()
  ? clerkMiddleware()
  : () => NextResponse.next();
```
`requireProductionEnvironment()` exists in `lib/env.ts` but is never invoked from the middleware or any route handler. There is no fail-closed path.

### M2 — Middleware matcher excludes the staff-management and audit surfaces

**Location:** `proxy.ts:11-13`
**Claim:** Even when Clerk is configured, the matcher `["/admin/:path*", "/api/admin/:path*"]` does not cover `/api/staff`, `/api/staff/[staffId]`, `/api/audit`, or `/api/setup`. Clerk middleware never executes on the most security-sensitive routes in P1.
**Evidence:**
```11:13:proxy.ts
export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
```
The matcher should cover every protected surface; instead it covers only the admin page tree and the single `/api/admin/security` route.

### M3 — Bootstrap lock, audit log, and staff records are in-memory only

**Location:** `lib/staff-store.ts:33-39`
**Claim:** All security state — `firstManagerCreated`, the staff roster, the audit trail, the impersonation pointer — lives in `globalThis.__p1StaffState`, an in-process object. It is not persisted, is not shared across instances, and resets on every server cold start. The bootstrap lockout (R-010), audit trail (R-120), and revocation (R-112) guarantees are non-functional across restarts and under any multi-instance deployment.
**Evidence:**
```33:39:lib/staff-store.ts
const state: State = globalThis.__p1StaffState ?? {
  firstManagerCreated: false,
  staff: [],
  audits: [],
};

globalThis.__p1StaffState = state;
```
The Prisma schema (`StaffUser`, `AuditEvent`, `SessionLoginStamp`) exists but is never written to. The status doc acknowledges "no PostgreSQL server," but from a security standpoint the access-control and audit guarantees are absent in the running app.

### M4 — Impersonation has no actor binding and no end event

**Location:** `lib/staff-store.ts:122-128`, `app/api/staff/[staffId]/route.ts:26-30`
**Claim:** `startImpersonation(staffId)` records only the target's email in the audit log; it never records who initiated the impersonation, never authenticates the initiator, and never writes an `impersonation_ended` event. There is no stop-impersonation path at all.
**Evidence:**
```122:128:lib/staff-store.ts
export function startImpersonation(staffId: string) {
  const staffMember = state.staff.find((candidate) => candidate.id === staffId);
  if (!staffMember || staffMember.revokedAt) return false;
  state.impersonatingId = staffId;
  addAudit("staff.impersonation_started", `Impersonating ${staffMember.email}`, staffId);
  return true;
}
```
`addAudit` takes no actor. Combined with B1/B4, any caller can impersonate any manager and the audit trail cannot attribute the action. R-099 requires impersonation with banner + audit; the audit is non-attributing.

### M5 — No CSRF protection on state-changing endpoints

**Location:** `app/api/setup/route.ts` (POST), `app/api/staff/route.ts` (POST), `app/api/staff/[staffId]/route.ts` (PATCH), `app/api/client-error/route.ts` (POST)
**Claim:** State-changing endpoints accept JSON bodies with no CSRF token, no `Origin`/`Referer` validation, and no same-origin check. A malicious third-party page can issue cross-site POSTs/PATCHes against these endpoints from a victim's browser.
**Evidence:** None of the route handlers inspect request headers for origin. They call `await request.json()` and act. Combined with the unauthenticated nature (B1), the impact is amplified, but CSRF controls are still missing independently.

### M6 — `/api/client-error` is unauthenticated, unbounded, and ignores its advertised token

**Location:** `app/api/client-error/route.ts:9-14`, `.env.example:4`
**Claim:** The client-error endpoint accepts any `message` (≤500 chars) and `path` (≤300 chars) and writes them to server logs with no auth, no rate limit, and no `ERROR_REPORTING_TOKEN` check — even though `.env.example` advertises that token. This is a log-injection / log-pollution vector and a misleading security posture.
**Evidence:**
```9:14:app/api/client-error/route.ts
export async function POST(request: Request) {
  const parsed = reportSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid error report." }, { status: 400 });
  console.error("client_error", { path: parsed.data.path, message: parsed.data.message });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
```
`.env.example` lists `ERROR_REPORTING_TOKEN="replace_me"` but no code reads it. An attacker can flood server logs with arbitrary strings, potentially burying real audit/security events.

### M7 — `maskError` leaks raw error text outside production

**Location:** `lib/foundation.ts:26-29`
**Claim:** Error masking only applies when `NODE_ENV === "production"`. In every other environment (staging, preview, review apps, dev), raw `Error.message` strings are returned to the client, potentially leaking internal stack details, file paths, and SQL/driver errors.
**Evidence:**
```26:29:lib/foundation.ts
export function maskError(error: unknown) {
  if (process.env.NODE_ENV === "production") return "Something went wrong. Please try again.";
  return error instanceof Error ? error.message : "Unexpected error.";
}
```
R-136 (production error masking) is satisfied for production only; non-production environments that face external traffic (preview deployments, staging) leak internals.

---

## Minor

### m1 — `/api/health` discloses required environment variable names

**Location:** `app/api/health/route.ts:11`
**Claim:** The health endpoint returns `requiredEnvironment: ["DATABASE_URL", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]` to any caller. Minor reconnaissance aid — confirms which secrets an attacker must exfiltrate.
**Evidence:**
```11:app/api/health/route.ts
    requiredEnvironment: ["DATABASE_URL", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"],
```

### m2 — `SessionLoginStamp` schema exists but is never written

**Location:** `prisma/schema.prisma:63-69`, `lib/staff-store.ts` (no login-stamp call)
**Claim:** R-120 requires "session login stamps." The model is defined but no code path creates a `SessionLoginStamp` row. The security control is absent in implementation.
**Evidence:** Grep of `staff-store.ts` and route handlers shows no `sessionLoginStamp` create call. The in-memory store has no equivalent field on `StaffUser`.

### m3 — `AuditEvent.details` typed as `Json` in Prisma but as `string` in the runtime store

**Location:** `prisma/schema.prisma:59` vs `lib/staff-store.ts:18-24`
**Claim:** Schema/runtime type drift on the audit `details` field. The Prisma model declares `Json`; the in-memory `AuditEvent` uses `string`. When the persistence layer is wired, the shape will need conversion and risks losing or mis-serializing audit data.
**Evidence:** `details: Json` (schema) vs `details: string` (staff-store). Not a direct exploit, but a correctness risk on the audit trail that affects forensic integrity.

### m4 — `normalizePhone` performs no validation

**Location:** `lib/foundation.ts:18-20`
**Claim:** `normalizePhone` strips non-digits and a leading `1` but never validates that the result is a 10-digit US number. Garbage input (`"abc"`) normalizes to `""` and is accepted. P1 lands this helper; downstream consumers will inherit unvalidated phone data.
**Evidence:**
```18:20:lib/foundation.ts
export function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "").replace(/^1/, "");
}
```

### m5 — `revokeStaff` is irreversible and silently idempotent

**Location:** `lib/staff-store.ts:114-120`
**Claim:** Revocation sets `revokedAt` once and returns `true` even on repeat calls. There is no un-revoke path and no audit distinguisher between first and subsequent revocations. Operationally minor, but it means a revoked-then-reinvited user cannot be cleanly represented and the audit trail cannot tell "revoked" from "re-revoked."
**Evidence:**
```114:120:lib/staff-store.ts
export function revokeStaff(staffId: string) {
  const staffMember = state.staff.find((candidate) => candidate.id === staffId);
  if (!staffMember) return false;
  staffMember.revokedAt = new Date().toISOString();
  addAudit("staff.revoked", `Revoked ${staffMember.email}`, staffId);
  return true;
}
```
Repeated calls re-stamp `revokedAt` and append duplicate audit rows.

---

## Notes on scope

- All findings are within P1 deliverables (foundation, identity, roles, permissions, staff tooling, audit, health, error reporting). No out-of-phase scope introduced.
- The arm's status doc acknowledges the PostgreSQL adapter is not live-tested (dev-memory fallback). Several findings (B6, M3, m2) are aggravated by that fallback but would still apply, in part, against the Prisma-backed implementation because the route handlers themselves lack auth/permission gates.
