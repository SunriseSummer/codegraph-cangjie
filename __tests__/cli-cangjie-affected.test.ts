import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeGraph, loadGrammarsForLanguages } from '../src';

const BIN = path.resolve(__dirname, '../dist/bin/codegraph.js');

function affected(cwd: string, changedFile: string): string[] {
  const output = execFileSync(
    process.execPath,
    [BIN, 'affected', changedFile, '--quiet', '-p', cwd],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEGRAPH_NO_DAEMON: '1',
        CODEGRAPH_WASM_RELAUNCHED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

describe('codegraph affected — Cangjie unit tests', () => {
  let projectDir = '';

  beforeAll(async () => {
    await loadGrammarsForLanguages(['cangjie']);
  });

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-cangjie-affected-'));
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'src', 'math.cj'),
      `package affected

public func add(left: Int64, right: Int64): Int64 {
    left + right
}
`
    );
    fs.writeFileSync(
      path.join(projectDir, 'src', 'math_test.cj'),
      `package affected

@Test
func addTest(): Unit {
    @Expect(add(2, 3), 5)
}
`
    );
    const graph = CodeGraph.initSync(projectDir);
    await graph.indexAll();
    graph.destroy();
  });

  afterEach(() => {
    if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('returns the official *_test.cj file for a changed production file', () => {
    expect(affected(projectDir, 'src/math.cj')).toEqual(['src/math_test.cj']);
  });

  it('includes a changed *_test.cj file directly', () => {
    expect(affected(projectDir, 'src/math_test.cj')).toEqual(['src/math_test.cj']);
  });
});
