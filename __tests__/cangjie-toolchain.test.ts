import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CANGJIE_SYNTAX_CASES } from './fixtures/cangjie-syntax-cases';

// Source-only contributors need no compiler. Release validation explicitly
// opts in, so a missing/wrong SDK fails instead of silently skipping a check.
describe.skipIf(process.env.CANGJIE_TEST_TOOLCHAIN !== '1')('official Cangjie 1.0.6 toolchain', () => {
  let temporaryRoot = '';
  const fixtures = path.join(__dirname, 'fixtures', 'cangjie-1.0.6');

  beforeAll(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-cjc-106-'));
    fs.cpSync(fixtures, temporaryRoot, { recursive: true });
  });

  afterAll(() => {
    if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  function run(command: string, args: string[], project?: string): string {
    const result = spawnSync(command, args, {
      cwd: project ? path.join(temporaryRoot, project) : temporaryRoot,
      encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    expect(result.error, output).toBeUndefined();
    expect(result.status, output).toBe(0);
    return output;
  }

  it('uses the requested compiler and project manager', () => {
    expect(run('cjc', ['--version'])).toMatch(/Compiler: 1\.0\.6\b/);
    expect(run('cjpm', ['--version'])).toMatch(/Manager: 1\.0\.6\b/);
  });

  it.each([
    ['codegraph-feature-matrix', 'feature-matrix: 13'],
    ['codegraph-import-boundaries', 'import-boundaries: 106'],
    ['codegraph-concurrency', 'concurrency: 5'],
    ['codegraph-sync', 'sync: 0.500000'],
    ['codegraph-values', 'values: 17'],
  ])('compiles and executes %s', (project, expected) => {
    expect(run('cjpm', ['run'], project)).toContain(expected);
  }, 150_000);

  it('compiles and passes the official unit-test macro', () => {
    expect(run('cjpm', ['test'], 'codegraph-sync')).toContain('cjpm test success');
  }, 150_000);

  // Test macros are compiled by cjpm test above. The other surface cases are
  // real static libraries, so a tree-sitter recovery cannot hide invalid code.
  it.each(CANGJIE_SYNTAX_CASES.filter(example => example.name !== 'test annotations and lifecycle methods'))
  ('compiles the $name language example', ({ source, name }) => {
    const directory = path.join(temporaryRoot, '语法 空间', name);
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'probe.cj');
    fs.writeFileSync(file, `package syntax\n${source}\n`);
    run('cjc', ['--output-type', 'staticlib', file, '-o', path.join(directory, 'probe.a')]);
  }, 150_000);
});
