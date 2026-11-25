import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractFromSource } from '../src/extraction';
import { loadGrammarsForLanguages } from '../src/extraction/grammars';
import { resetKernelForTests, tryKernelExtract } from '../src/extraction/kernel';
import type { ExtractionResult } from '../src/types';
import { CANGJIE_SYNTAX_CASES } from './fixtures/cangjie-syntax-cases';

const nativeBuilt = fs.existsSync(path.join(__dirname, '..', 'codegraph-kernel', 'prebuilds', `${process.platform}-${process.arch}`, 'codegraph-kernel.node'));
const cases = CANGJIE_SYNTAX_CASES;

function canonical(result: ExtractionResult): unknown {
  return {
    nodes: result.nodes.map(({ updatedAt: _, ...node }) => JSON.stringify(node, Object.keys(node).sort())).sort(),
    edges: result.edges.map(edge => JSON.stringify(edge, Object.keys(edge).sort())).sort(),
    refs: result.unresolvedReferences.map(ref => JSON.stringify(ref, Object.keys(ref).sort())).sort(),
  };
}

describe('Cangjie language surface matrix', () => {
  beforeAll(async () => { await loadGrammarsForLanguages(['cangjie']); });
  afterEach(() => { delete process.env.CODEGRAPH_KERNEL; resetKernelForTests(); });

  it.each(cases)('extracts $name with LF and CRLF and agrees across engines', ({ source, symbols }) => {
    for (const newline of ['\n', '\r\n']) {
      const text = `package syntax\n${source}\n`.replaceAll('\n', newline);
      const file = '项目 空间/模块.cj';
      process.env.CODEGRAPH_KERNEL = '0'; resetKernelForTests();
      const wasm = extractFromSource(file, text, 'cangjie');
      expect(wasm.errors).toEqual([]);
      if (source.includes('static init')) expect(wasm.nodes.find(n => n.kind === 'method' && n.name === 'init')?.isStatic).toBe(true);
      for (const [kind, name] of symbols) expect(wasm.nodes.some(n => n.kind === kind && n.name === name), `${kind}:${name}`).toBe(true);
      expect(wasm.unresolvedReferences.some(r => /fake(?:Top|Nested|String)/.test(r.referenceName))).toBe(false);
      delete process.env.CODEGRAPH_KERNEL; resetKernelForTests();
      if (nativeBuilt) {
        const native = tryKernelExtract(file, text, 'cangjie');
        expect(native).not.toBeNull();
        expect(canonical(native!)).toEqual(canonical(wasm));
      }
    }
  });

  it('recovers useful declarations from an unfinished editor buffer', () => {
    process.env.CODEGRAPH_KERNEL = '0'; resetKernelForTests();
    const result = extractFromSource('partial.cj', 'package partial\nfunc ready(): Int64 { 1 }\nclass Editing { func unfinished(', 'cangjie');
    expect(result.nodes.some(n => n.name === 'ready' && n.kind === 'function')).toBe(true);
    if (nativeBuilt) {
      delete process.env.CODEGRAPH_KERNEL; resetKernelForTests();
      expect(tryKernelExtract('partial.cj', 'package partial\nfunc ready(): Int64 { 1 }\nclass Editing { func unfinished(', 'cangjie')).toBeNull();
    }
  });
});
