import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The bookkeeping every phase smoke run needs: record a check, stop on the
 * first failure, and leave a table behind as the phase's evidence file.
 *
 * Each phase script owns its checks; none of them owns the reporting.
 */
export type CheckResult = { id: string; description: string; passed: boolean; evidence: string };

export class SmokeRun {
  private readonly results: CheckResult[] = [];

  constructor(
    private readonly phase: string,
    private readonly preamble: string[],
  ) {}

  record(id: string, description: string, passed: boolean, evidence: string): void {
    this.results.push({ id, description, passed, evidence });
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${id}  ${description}\n        ${evidence}`);
  }

  /** A check the run cannot continue past: everything after it would be noise. */
  expect(id: string, description: string, condition: boolean, evidence: string): void {
    this.record(id, description, condition, evidence);
    if (!condition) throw new Error(`${id} failed: ${evidence}`);
  }

  /** Cites named unit tests from a TAP run as the evidence for a check. */
  expectTest(id: string, description: string, passed: Set<string>, names: string[]): void {
    const missing = names.filter((name) => !passed.has(name));
    this.expect(
      id,
      description,
      missing.length === 0,
      missing.length === 0
        ? names.map((name) => `"${name}"`).join('; ')
        : `missing: ${missing.join('; ')}`,
    );
  }

  write(): void {
    const failed = this.results.filter((result) => !result.passed);
    const lines = [
      `# Phase ${this.phase} smoke evidence — arm-04`,
      '',
      ...this.preamble,
      '',
      '| # | Check | Result | Evidence |',
      '|---|---|---|---|',
      ...this.results.map(
        (result) =>
          `| ${result.id} | ${result.description} | ${result.passed ? 'PASS' : 'FAIL'} | ${result.evidence.replace(/\|/g, '\\|')} |`,
      ),
      '',
      `**${this.results.length - failed.length}/${this.results.length} checks passed.**`,
      '',
    ];

    const target = path.resolve(process.cwd(), `.scratch/PHASE-${this.phase}-SMOKE.md`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, lines.join('\n'), 'utf8');
    console.log(`\nWrote ${target}`);

    if (failed.length > 0) process.exitCode = 1;
  }
}

export function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): { status: number; output: string } {
  const child = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env,
  });

  return { status: child.status ?? -1, output: `${child.stdout ?? ''}${child.stderr ?? ''}` };
}

/**
 * Runs test files and reports which named tests passed.
 *
 * The database is named here rather than left to `--env-file`, which does not
 * override a DATABASE_URL that is already set — and importing `@prisma/client`
 * in the calling script sets it to the development one. Without this the suite
 * runs against the database the smoke run is inspecting and reports on it.
 */
export function runTests(
  files: string[],
  databaseUrl: string,
): { passed: string[]; failed: string[] } {
  const child = runCommand(
    'node',
    [
      '--import', 'tsx',
      '--conditions=react-server',
      '--env-file=.env.test',
      '--test-concurrency=1',
      '--test-reporter=tap',
      '--test',
      ...files,
    ],
    { ...process.env, DATABASE_URL: databaseUrl },
  );

  const passed: string[] = [];
  const failed: string[] = [];

  for (const line of child.output.split('\n')) {
    const okMatch = /^ok \d+ - (.+)$/.exec(line.trim());
    if (okMatch) passed.push(okMatch[1].trim());

    const failMatch = /^not ok \d+ - (.+)$/.exec(line.trim());
    if (failMatch) failed.push(failMatch[1].trim());
  }

  return { passed, failed };
}

export function lineContaining(output: string, needle: string): string {
  const match = output.split('\n').find((line) => line.includes(needle));
  return (match ?? output.trim().split('\n').at(-1) ?? '').trim();
}
