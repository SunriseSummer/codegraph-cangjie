import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodeGraph, loadGrammarsForLanguages } from '../src';
import { resetKernelForTests } from '../src/extraction/kernel';
import type { Node } from '../src/types';

const DEFINITIONS = `package engineering
public const LIMIT: Int64 = 8
public func handler(value: Int64): Int64 { value + LIMIT }
public func recursive(value: Int64): Int64 {
    if (value <= 0) { return 0 }
    recursive(value - 1)
}
`;
const READERS = `package engineering
public func readGlobal(): Int64 { LIMIT }
public func readFunction(): (Int64) -> Int64 { handler }
public func parameterShadow(LIMIT: Int64): Int64 { LIMIT }
public func localShadow(): Int64 { let LIMIT = 4; LIMIT }
public func loopShadow(): Unit { for (LIMIT in [1, 2]) { println(LIMIT) } }
public func lambdaShadow(): Int64 { let f = { LIMIT: Int64 => LIMIT }; f(4) }
public func matchShadow(value: ?Int64): Int64 {
    match(value) { case Some(LIMIT) => LIMIT; case None => 0 }
}
public func blockShadow(): Int64 {
    if (true) { let LIMIT = 3; println(LIMIT) }
    LIMIT
}
public func captureGlobal(): Int64 { let f = { => LIMIT }; f() }
public func parameterCallback(handler: (Int64) -> Int64): Int64 { handler(1) }
public func localCallback(): Int64 { let handler = { n: Int64 => n + 1 }; handler(1) }
`;

for (const engine of ['native', 'wasm'] as const) {
  describe(`Cangjie engineering contracts (${engine})`, () => {
    let root = '';
    let graph: CodeGraph | undefined;
    let previous: string | undefined;

    beforeAll(async () => { await loadGrammarsForLanguages(['cangjie']); });
    afterEach(() => {
      graph?.destroy(); graph = undefined;
      if (root) fs.rmSync(root, { recursive: true, force: true });
      root = '';
      if (previous === undefined) delete process.env.CODEGRAPH_KERNEL;
      else process.env.CODEGRAPH_KERNEL = previous;
      resetKernelForTests();
    });

    async function index(files: Record<string, string> = {}): Promise<CodeGraph> {
      previous = process.env.CODEGRAPH_KERNEL;
      if (engine === 'wasm') process.env.CODEGRAPH_KERNEL = '0';
      else delete process.env.CODEGRAPH_KERNEL;
      resetKernelForTests();
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cangjie-engineering-'));
      for (const [file, source] of Object.entries({ 'src/defs.cj': DEFINITIONS, 'src/readers.cj': READERS, ...files })) {
        const full = path.join(root, file);
        fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, source);
      }
      graph = CodeGraph.initSync(root); await graph.indexAll();
      return graph;
    }

    function one(name: string): Node {
      const nodes = graph!.getNodesByName(name).filter(n => n.language === 'cangjie');
      expect(nodes, name).toHaveLength(1); return nodes[0]!;
    }
    function dependencies(name: string, kind = 'references'): string[] {
      return graph!.getOutgoingEdges(one(name).id).filter(e => e.kind === kind)
        .map(e => graph!.getNode(e.target)?.qualifiedName ?? 'missing');
    }

    it('records a constant read across files for impact analysis', async () => {
      await index(); expect(dependencies('readGlobal')).toContain('engineering::LIMIT');
    });
    it('records a function used as a value without fabricating a call', async () => {
      await index(); expect(dependencies('readFunction')).toContain('engineering::handler');
      expect(dependencies('readFunction', 'calls')).not.toContain('engineering::handler');
    });
    it.each(['parameterShadow', 'localShadow', 'loopShadow', 'lambdaShadow', 'matchShadow'])
    ('keeps %s from reading a same-named global', async name => {
      await index(); expect(dependencies(name)).not.toContain('engineering::LIMIT');
    });
    it('ends block shadowing at the closing brace and follows a closure capture', async () => {
      await index();
      expect(dependencies('blockShadow')).toContain('engineering::LIMIT');
      expect(dependencies('captureGlobal')).toContain('engineering::LIMIT');
    });
    it.each(['parameterCallback', 'localCallback'])('does not bind %s to an unrelated global function', async name => {
      await index(); expect(dependencies(name, 'calls')).not.toContain('engineering::handler');
    });
    it('retains a recursive call as a self edge', async () => {
      await index(); expect(dependencies('recursive', 'calls')).toContain('engineering::recursive');
    });
    it('does not resolve a miss to a symbol in another language or package', async () => {
      await index({
        'foreign.ts': 'export const FOREIGN = 1; export function absent() {}',
        'other.cj': 'package other\npublic const FOREIGN = 1\npublic func absent(): Unit {}',
        'src/miss.cj': 'package engineering\nfunc miss(): Unit { println(FOREIGN); absent() }',
      });
      expect(dependencies('miss')).toEqual([]); expect(dependencies('miss', 'calls')).toEqual([]);
    });
    it('heals constant dependencies after deleting and restoring a callee file', async () => {
      await index();
      expect(dependencies('readGlobal')).toContain('engineering::LIMIT');
      fs.unlinkSync(path.join(root, 'src/defs.cj'));
      await graph!.sync({ paths: ['src/defs.cj'] });
      expect(dependencies('readGlobal')).toEqual([]);
      fs.writeFileSync(path.join(root, 'src/defs.cj'), `// moved declarations\n${DEFINITIONS}`);
      await graph!.sync({ paths: ['src/defs.cj'] });
      expect(dependencies('readGlobal')).toContain('engineering::LIMIT');
      const incoming = graph!.getIncomingEdges(one('LIMIT').id).map(e => graph!.getNode(e.source)?.qualifiedName).sort();
      await graph!.indexAll();
      expect(graph!.getIncomingEdges(one('LIMIT').id).map(e => graph!.getNode(e.source)?.qualifiedName).sort()).toEqual(incoming);
    });
    it('keeps Unicode and space-containing paths correct through a directory rename', async () => {
      await index({ 'src/模块 space/api.cj': 'package engineering\npublic func 中文入口(): Int64 { LIMIT }' });
      expect(dependencies('中文入口')).toContain('engineering::LIMIT');
      fs.renameSync(path.join(root, 'src/模块 space'), path.join(root, 'src/模块 新'));
      const result = await graph!.sync({ paths: ['src/模块 space/api.cj', 'src/模块 新/api.cj'] });
      expect(result.filesAdded).toBe(1); expect(result.filesRemoved).toBe(1);
      expect(one('中文入口').filePath).toContain('模块 新');
      expect(dependencies('中文入口')).toContain('engineering::LIMIT');
    });
    it('keeps 80 same-named types isolated across 80 packages and after partial sync', async () => {
      const files: Record<string, string> = {};
      const count = 80;
      for (let i = 0; i < count; i++) {
        const name = `m${String(i).padStart(3, '0')}`;
        files[`src/${name}/worker.cj`] = `package engineering.${name}\npublic class Worker { public init() {}; public func run(): Int64 { ${i} } }`;
        files[`src/${name}/use.cj`] = `package engineering.${name}\npublic func execute_${i}(): Int64 { let worker = Worker(); worker.run() }`;
      }
      await index(files);
      for (let i = 0; i < count; i++) {
        const name = `m${String(i).padStart(3, '0')}`;
        expect(dependencies(`execute_${i}`, 'calls')).toEqual([`engineering.${name}::Worker::run`]);
      }
      const changed = ['src/m001/worker.cj', 'src/m039/worker.cj', 'src/m079/worker.cj'];
      for (const file of changed) fs.writeFileSync(path.join(root, file), `// moved definition\n${files[file]}`);
      await graph!.sync({ paths: changed });
      const snapshot = () => Array.from({ length: count }, (_, i) => dependencies(`execute_${i}`, 'calls'));
      const incremental = snapshot();
      await graph!.indexAll();
      expect(snapshot()).toEqual(incremental);
    }, 120_000);
  });
}
