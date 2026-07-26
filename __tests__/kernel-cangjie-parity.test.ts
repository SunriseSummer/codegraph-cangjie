/**
 * Cangjie 1.0.5 native↔WASM extraction parity.
 *
 * The native grammar and the vendored WASM are generated from the same
 * parser/scanner sources. This test additionally pins semantic parity for the
 * Cangjie-specific declaration, extension, property, call and reference paths.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { extractFromSource } from '../src/extraction';
import { initGrammars, loadGrammarsForLanguages } from '../src/extraction/grammars';
import { resetKernelForTests, tryKernelExtract } from '../src/extraction/kernel';
import type { ExtractionResult } from '../src/types';

const KERNEL_PATH = path.join(
  __dirname,
  '..',
  'codegraph-kernel',
  'prebuilds',
  `${process.platform}-${process.arch}`,
  'codegraph-kernel.node'
);
const FIXTURE = path.join(__dirname, 'fixtures', 'kernel-parity', 'torture.cj');
const kernelBuilt = fs.existsSync(KERNEL_PATH);
const ENV_KEYS = ['CODEGRAPH_KERNEL', 'CODEGRAPH_KERNEL_LANGS'] as const;
let savedEnv: Record<string, string | undefined>;

function canon(result: ExtractionResult): {
  nodes: string[];
  edges: string[];
  refs: string[];
} {
  return {
    nodes: result.nodes
      .map(({ updatedAt: _updatedAt, ...node }) =>
        JSON.stringify(node, Object.keys(node).sort())
      )
      .sort(),
    edges: result.edges
      .map((edge) => JSON.stringify(edge, Object.keys(edge).sort()))
      .sort(),
    refs: result.unresolvedReferences
      .map((ref) => JSON.stringify(ref, Object.keys(ref).sort()))
      .sort(),
  };
}

describe.skipIf(!kernelBuilt)('kernel Cangjie extraction parity', () => {
  beforeAll(async () => {
    await initGrammars();
    await loadGrammarsForLanguages(['cangjie']);
  });

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    resetKernelForTests();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    resetKernelForTests();
  });

  it('matches the semantic torture fixture including CRLF positions', () => {
    const original = fs.readFileSync(FIXTURE, 'utf8');
    for (const [name, source] of [
      ['LF', original],
      ['CRLF', original.replace(/(?<!\r)\n/g, '\r\n')],
    ] as const) {
      process.env.CODEGRAPH_KERNEL_LANGS = 'all';
      delete process.env.CODEGRAPH_KERNEL;
      const native = tryKernelExtract(`fixtures/torture-${name}.cj`, source, 'cangjie');
      expect(native, `${name}: native extraction`).not.toBeNull();

      process.env.CODEGRAPH_KERNEL = '0';
      const wasm = extractFromSource(`fixtures/torture-${name}.cj`, source, 'cangjie');
      delete process.env.CODEGRAPH_KERNEL;

      expect(canon(native!), `${name}: native/WASM parity`).toEqual(canon(wasm));
    }
  });

  it('defers malformed files to the WASM recovery path', () => {
    process.env.CODEGRAPH_KERNEL_LANGS = 'all';
    delete process.env.CODEGRAPH_KERNEL;
    expect(tryKernelExtract('broken.cj', 'class Broken { func f(', 'cangjie')).toBeNull();
  });
});
