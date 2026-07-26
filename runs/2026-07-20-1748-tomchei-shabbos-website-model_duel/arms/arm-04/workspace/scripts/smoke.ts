import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { findForm, parseForms, Session, type ParsedForm } from './http-form';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3104';

const MANAGER = { email: 'manager@tomchei.example', fullName: 'Rivka Manager' };
const HELPER = { email: 'helper@tomchei.example', fullName: 'Yossi Helper' };
const DRIVER = { email: 'driver@tomchei.example', fullName: 'Dov Driver' };

type CheckResult = { id: string; description: string; passed: boolean; evidence: string };

const results: CheckResult[] = [];

function record(id: string, description: string, passed: boolean, evidence: string) {
  results.push({ id, description, passed, evidence });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${id}  ${description}\n        ${evidence}`);
}

function expect(id: string, description: string, condition: boolean, evidence: string) {
  record(id, description, condition, evidence);
  if (!condition) throw new Error(`${id} failed: ${evidence}`);
}

async function main() {
  const manager = new Session(BASE_URL);

  // ---------------------------------------------------------------- S1 / S2
  const home = await manager.get('/');
  expect('S1', 'Storefront responds', home.status === 200 && home.body.includes('Tomchei Shabbos'),
    `GET / -> ${home.status}, brand name present`);

  const health = await manager.get('/api/health');
  const healthJson = JSON.parse(health.body) as { status: string; database: string };
  expect('S2', 'Health check green with DB connected',
    health.status === 200 && healthJson.status === 'ok' && healthJson.database === 'ok',
    `GET /api/health -> ${health.status} ${health.body}`);

  // ------------------------------------------------------------------- S4
  const setupPage = await manager.get('/setup');
  expect('S4a', 'Empty database offers first-run setup', setupPage.status === 200,
    `GET /setup -> ${setupPage.status}`);

  const setupForm = parseForms(setupPage.body, '/setup')[0];
  const bootstrap = await manager.submit(setupForm, {
    fullName: MANAGER.fullName,
    email: MANAGER.email,
  });
  expect('S4b', 'Setup creates the first manager and signs them in',
    bootstrap.status === 303 && bootstrap.headers.get('location')?.endsWith('/admin') === true,
    `POST /setup -> ${bootstrap.status} Location=${bootstrap.headers.get('location')}`);

  const lockedSetup = await manager.get('/setup');
  expect('S4c', 'Setup locks once a manager exists', lockedSetup.status === 403,
    `GET /setup -> ${lockedSetup.status}`);

  const dashboard = await manager.get('/admin');
  expect('S4d', 'The bootstrapped manager reaches the admin dashboard',
    dashboard.status === 200 && dashboard.body.includes('Dashboard'),
    `GET /admin -> ${dashboard.status}`);

  // -------------------------------------------------- staff management UI
  await inviteStaff(manager, HELPER, 'DRIVER');
  await inviteStaff(manager, DRIVER, 'DRIVER');

  const helperId = await activate(manager, HELPER.email);
  await activate(manager, DRIVER.email);

  await changeRole(manager, HELPER.email, 'STAFF');
  const helperDetail = await manager.get(`/admin/staff/${helperId}`);
  expect('P1-1', 'Role change through the staff table lands in the database',
    helperDetail.status === 200 && roleBadge(helperDetail.body, HELPER.email) === 'STAFF',
    `${HELPER.email} reads back as ${roleBadge(helperDetail.body, HELPER.email)} on /admin/staff/${helperId}`);

  // ------------------------------------------- optimistic concurrency surfaced
  const staffTable = await manager.get('/admin/staff');
  const driverRoleForm = staffRow(staffTable.body, DRIVER.email).forms.find((form) =>
    form.html.includes('name="role"'),
  );
  if (!driverRoleForm) throw new Error('No role control to replay');

  // Same role both times: the point is the version the form was rendered with,
  // which the first write consumes and the replay can no longer match.
  await manager.submit(driverRoleForm, { role: 'DRIVER' });
  const replay = await manager.submit(driverRoleForm, { role: 'DRIVER' });
  const replayLocation = replay.headers.get('location') ?? '';
  const conflictPage = await manager.get(replayLocation || '/admin/staff');
  expect('P1-10', 'A lost concurrent edit is reported instead of silently discarded',
    replayLocation.includes('error=stale_version') &&
      conflictPage.body.includes('data-testid="staff-action-error"'),
    `replayed role form -> ${replay.status} ${replayLocation}, notice rendered on the staff page`);

  const rejected = await manager.submit(driverRoleForm, { role: 'SUPERUSER' });
  expect('P1-11', 'An out-of-enum role is refused before it reaches the database',
    (rejected.headers.get('location') ?? '').includes('error=invalid_submission'),
    `role=SUPERUSER -> ${rejected.status} ${rejected.headers.get('location')}`);

  // ------------------------------------------------------------------- S3
  const helper = new Session(BASE_URL);
  await signIn(helper, HELPER.email);

  const helperDashboard = await helper.get('/admin');
  expect('S3a', 'Staff reach pages their role allows', helperDashboard.status === 200,
    `GET /admin as staff -> ${helperDashboard.status}`);

  const helperSettings = await helper.get('/admin/settings');
  expect('S3b', 'Staff without the permission get 403 on a gated admin page',
    helperSettings.status === 403 && helperSettings.body.includes('403'),
    `GET /admin/settings as staff -> ${helperSettings.status}`);

  const helperStaffPage = await helper.get('/admin/staff');
  expect('S3c', 'Staff cannot open staff management', helperStaffPage.status === 403,
    `GET /admin/staff as staff -> ${helperStaffPage.status}`);

  expect('S3d', 'The sidebar hides links the user cannot open',
    !helperDashboard.body.includes('href="/admin/settings"'),
    'no Settings link rendered for staff');

  // --------------------------------------------------- permission overrides
  await setOverride(manager, helperId, 'settings.manage', 'GRANT');
  const grantedSettings = await helper.get('/admin/settings');
  expect('P1-2', 'A grant override opens a page the role blocks', grantedSettings.status === 200,
    `GET /admin/settings after GRANT -> ${grantedSettings.status}`);

  await setOverride(manager, helperId, 'settings.manage', 'DENY');
  const deniedSettings = await helper.get('/admin/settings');
  expect('P1-3', 'A deny override closes it again', deniedSettings.status === 403,
    `GET /admin/settings after DENY -> ${deniedSettings.status}`);

  await setOverride(manager, helperId, 'orders.view', 'DENY');
  const afterDeny = await manager.get(`/admin/staff/${helperId}`);
  expect('P1-4', 'Deny beats the role default',
    permissionState(afterDeny.body, 'orders.view') === 'blocked',
    `orders.view is a STAFF default and reads back as ${permissionState(afterDeny.body, 'orders.view')}`);

  // ------------------------------------------------------- driver isolation
  const driver = new Session(BASE_URL);
  await signIn(driver, DRIVER.email);

  const driverAdmin = await driver.get('/admin');
  expect('P1-5', 'A driver cannot open the admin, and sees none of its chrome',
    driverAdmin.status === 403 && !driverAdmin.body.includes('Visit store'),
    `GET /admin as driver -> ${driverAdmin.status}, no admin header rendered around the 403`);

  const driverHome = await driver.get('/driver');
  expect('P1-6', 'A driver reaches the driver area', driverHome.status === 200,
    `GET /driver as driver -> ${driverHome.status}`);

  // ------------------------------------------------------------------- S5
  const impersonation = await impersonate(manager, helperId);
  expect('S5a', 'Manager can impersonate a staff member',
    impersonation.status === 303,
    `POST impersonate -> ${impersonation.status}`);

  const impersonated = await manager.get('/admin');
  expect('S5b', 'The impersonation banner names both people',
    impersonated.body.includes('impersonation-banner') &&
      impersonated.body.includes(MANAGER.fullName) &&
      impersonated.body.includes(HELPER.fullName),
    'banner shows actor and impersonated staff');

  const impersonatedSettings = await manager.get('/admin/settings');
  expect('S5c', 'While impersonating, the manager is limited to the target permissions',
    impersonatedSettings.status === 403,
    `GET /admin/settings while impersonating a denied staff member -> ${impersonatedSettings.status}`);

  const bannerStart = impersonated.body.indexOf('data-testid="impersonation-banner"');
  const bannerHtml = impersonated.body.slice(bannerStart, impersonated.body.indexOf('</div>', bannerStart));
  const stopForm = parseForms(bannerHtml, '/admin')[0];
  await manager.submit(stopForm);
  const afterStop = await manager.get('/admin');
  expect('S5d', 'Stopping impersonation restores the manager',
    !afterStop.body.includes('impersonation-banner') && afterStop.status === 200,
    'banner gone after stopping');

  const auditPage = await manager.get('/admin/audit');
  const auditActions = [
    'setup.first_manager_created',
    'staff.invited',
    'staff.role_changed',
    'staff.permission_override_changed',
    'staff.impersonation_started',
    'staff.impersonation_stopped',
  ];
  const missing = auditActions.filter((action) => !auditPage.body.includes(action));
  expect('S5e', 'Role change and impersonation appear in the audit log',
    auditPage.status === 200 && missing.length === 0,
    missing.length === 0 ? `audit log contains ${auditActions.join(', ')}` : `missing ${missing.join(', ')}`);

  // ------------------------------------------------------- revoke enforcement
  await revoke(manager, HELPER.email);
  const afterRevoke = await helper.get('/admin');
  expect('P1-7', 'A revoked account fails its next protected request',
    afterRevoke.status === 401,
    `GET /admin with a revoked session -> ${afterRevoke.status}`);

  // -------------------------------------------------------- env validation
  const goodEnv = runEnvCheck({});
  expect('P1-8', 'Startup validation passes with a complete env', goodEnv.status === 0,
    goodEnv.output.trim());

  const badEnv = runEnvCheck({ DATABASE_URL: '' });
  expect('P1-9', 'A missing env var stops startup with a clear message',
    badEnv.status === 1 && badEnv.output.includes('DATABASE_URL'),
    badEnv.output.trim().split('\n').slice(0, 2).join(' / '));

  const placeholderSecret = runEnvCheck({
    AUTH_SESSION_SECRET: 'change-me-to-a-32-character-random-string',
  });
  expect('P1-12', 'The .env.example session secret cannot boot the app',
    placeholderSecret.status === 1 && placeholderSecret.output.includes('AUTH_SESSION_SECRET'),
    placeholderSecret.output.trim().split('\n').slice(0, 2).join(' / '));

  const publicLocalProvider = runEnvCheck({ APP_URL: 'https://staging.tomchei.example' });
  expect('P1-13', 'Passwordless local auth is refused on a non-loopback deployment',
    publicLocalProvider.status === 1 && publicLocalProvider.output.includes('AUTH_PROVIDER'),
    publicLocalProvider.output.trim().split('\n').slice(0, 2).join(' / '));

  writeReport();
}

async function inviteStaff(
  session: Session,
  person: { email: string; fullName: string },
  role: string,
) {
  const page = await session.get('/admin/staff');
  const inviteForm = findForm(parseForms(page.body, '/admin/staff'), { '$ACTION_KEY': keyOf(page.body) });
  const response = await session.submit(inviteForm, {
    fullName: person.fullName,
    email: person.email,
    role,
  });
  if (response.status >= 400) throw new Error(`Invite of ${person.email} returned ${response.status}`);
}

async function activate(session: Session, email: string): Promise<string> {
  const page = await session.get('/admin/staff');
  const { id, forms } = staffRow(page.body, email);
  const statusForm = forms.find((form) => form.fields.status === 'ACTIVE');
  if (!statusForm) throw new Error(`No activate control for ${email}`);
  await session.submit(statusForm);
  return id;
}

async function changeRole(session: Session, email: string, role: string) {
  const page = await session.get('/admin/staff');
  const { forms } = staffRow(page.body, email);
  const roleForm = forms.find((form) => form.html.includes('name="role"'));
  if (!roleForm) throw new Error(`No role control for ${email}`);
  await session.submit(roleForm, { role });
}

async function revoke(session: Session, email: string) {
  const page = await session.get('/admin/staff');
  const { forms } = staffRow(page.body, email);
  const statusForm = forms.find((form) => form.fields.status === 'REVOKED');
  if (!statusForm) throw new Error(`No revoke control for ${email}`);
  await session.submit(statusForm);
}

async function impersonate(session: Session, staffUserId: string): Promise<Response> {
  const page = await session.get('/admin/staff');
  const { forms } = staffRow(page.body, staffUserId);
  const impersonateForm = forms.find(
    (form) => form.fields.staffUserId === staffUserId && form.fields.version === undefined,
  );
  if (!impersonateForm) throw new Error('No impersonation control');
  return session.submit(impersonateForm);
}

async function setOverride(
  session: Session,
  staffUserId: string,
  permission: string,
  effect: string,
) {
  const page = await session.get(`/admin/staff/${staffUserId}`);
  const form = findForm(parseForms(page.body, `/admin/staff/${staffUserId}`), {
    staffUserId,
    permission,
  });
  await session.submit(form, { effect });
}

async function signIn(session: Session, email: string) {
  session.clearCookies();
  const page = await session.get('/sign-in');
  const form = parseForms(page.body, '/sign-in')[0];
  const response = await session.submit(form, { email });
  if (response.status !== 303) {
    throw new Error(`Sign-in for ${email} returned ${response.status}`);
  }
}

/**
 * The role badge in the staff detail header. Scoped to the paragraph holding
 * that person's email, because the admin chrome shows the signed-in role too.
 */
function roleBadge(html: string, email: string): string {
  const start = html.indexOf(email);
  if (start === -1) throw new Error(`No detail header for ${email}`);

  const header = html.slice(start, html.indexOf('</p>', start));
  const badges = ['MANAGER', 'STAFF', 'DRIVER'].filter((role) => header.includes(`>${role}</span>`));
  if (badges.length !== 1) throw new Error(`Expected one role badge, found ${badges.length}`);
  return badges[0];
}

function permissionState(html: string, permission: string): 'allowed' | 'blocked' {
  const row = html.split('<li').find((chunk) => chunk.includes(`<code>${permission}</code>`));
  if (!row) throw new Error(`No override row for ${permission}`);
  return row.includes('>blocked</span>') ? 'blocked' : 'allowed';
}

function staffRow(html: string, needle: string): { id: string; forms: ParsedForm[] } {
  for (const row of html.split('<tr').slice(1)) {
    if (!row.includes(needle)) continue;
    const id = /href="\/admin\/staff\/([^"]+)"/.exec(row)?.[1];
    if (id) return { id, forms: parseForms(row, '/admin/staff') };
  }
  throw new Error(`No staff row matching "${needle}"`);
}

/** The invite form is the only one carrying a useActionState key on that page. */
function keyOf(html: string): string {
  const key = /name="\$ACTION_KEY" value="([^"]*)"/.exec(html)?.[1];
  if (!key) throw new Error('Could not locate the invite form');
  return key;
}

function runEnvCheck(overrides: Record<string, string>): { status: number; output: string } {
  const child = spawnSync(
    'node',
    ['--import', 'tsx', '--conditions=react-server', 'scripts/env-check.ts'],
    {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:4104/tomchei?schema=public',
        APP_URL: 'http://127.0.0.1:3104',
        AUTH_PROVIDER: 'local',
        AUTH_SESSION_SECRET: 'local-development-session-secret-000001',
        ...overrides,
      },
    },
  );

  return { status: child.status ?? -1, output: `${child.stdout}${child.stderr}` };
}

function writeReport() {
  const failed = results.filter((result) => !result.passed);
  const lines = [
    '# Phase P1 smoke evidence — arm-04',
    '',
    `Run at ${new Date().toISOString()} against ${BASE_URL} (web 3104, db 4104).`,
    '',
    '| # | Check | Result | Evidence |',
    '|---|---|---|---|',
    ...results.map(
      (result) =>
        `| ${result.id} | ${result.description} | ${result.passed ? 'PASS' : 'FAIL'} | ${result.evidence.replace(/\|/g, '\\|')} |`,
    ),
    '',
    `**${results.length - failed.length}/${results.length} checks passed.**`,
    '',
  ];

  const target = path.resolve(process.cwd(), '.scratch/PHASE-P1-SMOKE.md');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, lines.join('\n'), 'utf8');
  console.log(`\nWrote ${target}`);

  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\nSmoke run stopped: ${error instanceof Error ? error.message : error}`);
  writeReport();
  process.exitCode = 1;
});
