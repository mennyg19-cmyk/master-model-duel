# P1 Fix Notes — arm-01

Date: 2026-07-20  
Scope: one post-review fix pass

## Resolved

- **B1:** `/api/setup` now gets the caller from server-side Clerk `auth()` through the shared authentication helper. The setup UI no longer sends or asks for a Clerk ID.
- **B2:** invitation acceptance binds only to the server-authenticated Clerk identity.
- **B3:** local header/default identity behavior is disabled unless the explicit test/CI-only `ENABLE_TEST_AUTH=true` flag is set.
- **B4:** invitation tokens remain hashed at rest and are revealed once to the authenticated manager immediately after creation. The UI surfaces the token with a dismissal control, and the reveal writes `staff.invitation_token_revealed`.
- **B5:** `/setup` now lives directly under `src/app/setup/`, outside the admin route tree, and renders before a Manager exists.
- **M2:** stopping impersonation closes matching open session rows, writes `staff.impersonation_ended`, clears the cookie, and is exposed from the impersonation banner.
- **M3:** Manager self-protection covers actor and effective identities and blocks self role, status, grant, or deny changes.
- **M9:** setup distinguishes the bootstrap lock sentinel from Prisma `P2002` identity/email conflicts.

## Verification

- `npm run lint`: pass.
- `npm test`: 4/4 pass.
- `npm run build`: pass.
- S1-S5 live smoke: pass on port 3101 against the isolated PostgreSQL database.
- Smoke evidence: `workspace/.scratch/PHASE-P1-SMOKE.md`.
