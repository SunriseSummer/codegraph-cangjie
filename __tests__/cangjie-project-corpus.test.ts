import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeGraph, loadGrammarsForLanguages } from '../src';
import { extractFromSource } from '../src/extraction';
import { resetKernelForTests, tryKernelExtract } from '../src/extraction/kernel';
import type { ExtractionResult, Node } from '../src/types';

const TEST_ROOT = path.resolve(__dirname, '..', '..', '.test');
const PROJECT_NAMES = [
  'codegraph-feature-matrix',
  'codegraph-import-boundaries',
  'codegraph-concurrency',
] as const;
const PROJECT_ROOTS = PROJECT_NAMES.map((name) => path.join(TEST_ROOT, name));
const KERNEL_PATH = path.join(
  __dirname,
  '..',
  'codegraph-kernel',
  'prebuilds',
  `${process.platform}-${process.arch}`,
  'codegraph-kernel.node'
);
const corpusAvailable = PROJECT_ROOTS.every((root) => fs.existsSync(root));
const kernelBuilt = fs.existsSync(KERNEL_PATH);

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'target' || entry.name === '.codegraph') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith('.cj')) files.push(absolute);
    }
  };
  walk(root);
  return files.sort();
}

function canon(result: ExtractionResult): {
  nodes: string[];
  edges: string[];
  refs: string[];
} {
  return {
    nodes: result.nodes
      .map(({ updatedAt: _updatedAt, ...node }) => JSON.stringify(node, Object.keys(node).sort()))
      .sort(),
    edges: result.edges.map((edge) => JSON.stringify(edge, Object.keys(edge).sort())).sort(),
    refs: result.unresolvedReferences
      .map((ref) => JSON.stringify(ref, Object.keys(ref).sort()))
      .sort(),
  };
}

function copySourceTree(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'target' || entry.name === '.codegraph') continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copySourceTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function oneByQualifiedName(graph: CodeGraph, qualifiedName: string): Node {
  const name = qualifiedName.split('::').pop() ?? qualifiedName;
  const matches = graph.getNodesByName(name).filter((node) => node.qualifiedName === qualifiedName);
  expect(matches, qualifiedName).toHaveLength(1);
  return matches[0]!;
}

describe.skipIf(!corpusAvailable)('Cangjie 1.0.5 executable project corpus', () => {
  beforeAll(async () => {
    await loadGrammarsForLanguages(['cangjie']);
  });

  for (const projectRoot of PROJECT_ROOTS) {
    it(`extracts ${path.basename(projectRoot)} without recovery`, () => {
      for (const absolute of sourceFiles(projectRoot)) {
        const relative = path.relative(projectRoot, absolute).replaceAll(path.sep, '/');
        const source = fs.readFileSync(absolute, 'utf8');

        process.env.CODEGRAPH_KERNEL = '0';
        resetKernelForTests();
        const wasm = extractFromSource(relative, source, 'cangjie');
        delete process.env.CODEGRAPH_KERNEL;
        resetKernelForTests();
        expect(wasm.errors, relative).toEqual([]);

        if (kernelBuilt) {
          process.env.CODEGRAPH_KERNEL_LANGS = 'all';
          const native = tryKernelExtract(relative, source, 'cangjie');
          delete process.env.CODEGRAPH_KERNEL_LANGS;
          resetKernelForTests();
          expect(native, `${relative}: native extraction`).not.toBeNull();
          expect(canon(native!), `${relative}: native/WASM parity`).toEqual(canon(wasm));
        }
      }
    });
  }
});

describe.skipIf(!corpusAvailable)('Cangjie project-level boundary resolution', () => {
  let temporaryRoot = '';
  let graph: CodeGraph | undefined;

  beforeAll(async () => {
    await loadGrammarsForLanguages(['cangjie']);
  });

  afterAll(() => {
    graph?.destroy();
    if (temporaryRoot) {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  const indexProject = async (name: string): Promise<CodeGraph> => {
    graph?.destroy();
    graph = undefined;
    if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), `codegraph-cangjie-${name}-`));
    copySourceTree(path.join(TEST_ROOT, name), temporaryRoot);
    graph = CodeGraph.initSync(temporaryRoot);
    await graph.indexAll();
    graph.resolveReferences();
    return graph;
  };

  it('keeps colliding symbols bound to aliases, packages, and re-exports', async () => {
    graph = await indexProject('codegraph-import-boundaries');

    const main = oneByQualifiedName(graph, 'codegraph_import_boundaries::main');
    const outgoing = graph.getOutgoingEdges(main.id).map((edge) => ({
      kind: edge.kind,
      target: graph!.getNode(edge.target)?.qualifiedName,
    }));
    const has = (kind: string, target: string): boolean =>
      outgoing.some((edge) => edge.kind === kind && edge.target === target);

    expect(has('instantiates', 'codegraph_import_boundaries.library::Widget')).toBe(true);
    expect(has('instantiates', 'codegraph_import_boundaries.other::Widget')).toBe(true);
    expect(has('calls', 'codegraph_import_boundaries.library::Widget::identity')).toBe(true);
    expect(has('calls', 'codegraph_import_boundaries.other::Widget::identity')).toBe(true);
    expect(has('calls', 'codegraph_import_boundaries.library::Widget::named')).toBe(true);
    expect(has('calls', 'codegraph_import_boundaries.library::makeLabel')).toBe(true);
    expect(has('calls', 'codegraph_import_boundaries.other::makeLabel')).toBe(true);
    expect(has('references', 'codegraph_import_boundaries.library::VERSION')).toBe(true);

    const direct = oneByQualifiedName(graph, 'codegraph_import_boundaries::directImportCheck');
    const wildcard = oneByQualifiedName(graph, 'codegraph_import_boundaries::wildcardImportCheck');
    const qualified = oneByQualifiedName(
      graph,
      'codegraph_import_boundaries::qualifiedImportCheck'
    );
    const reexport = oneByQualifiedName(
      graph,
      'codegraph_import_boundaries::reexportCheck'
    );
    const callsTarget = (node: Node, target: string): boolean =>
      graph!
        .getOutgoingEdges(node.id)
        .some(
          (edge) => edge.kind === 'calls' && graph!.getNode(edge.target)?.qualifiedName === target
        );

    expect(callsTarget(direct, 'codegraph_import_boundaries.library::makeLabel')).toBe(true);
    expect(callsTarget(wildcard, 'codegraph_import_boundaries.other::makeLabel')).toBe(true);
    expect(callsTarget(qualified, 'codegraph_import_boundaries.library::makeLabel')).toBe(true);
    expect(callsTarget(reexport, 'codegraph_import_boundaries.library::makeLabel')).toBe(true);
  }, 120_000);

  it('resolves the executable feature matrix including overloads and extensions', async () => {
    graph = await indexProject('codegraph-feature-matrix');
    const main = oneByQualifiedName(graph, 'codegraph_feature_matrix::main');
    const outgoing = graph.getOutgoingEdges(main.id);
    const targetIds = new Set(outgoing.map((edge) => edge.target));
    const targetQualifiedNames = new Set(
      outgoing.map((edge) => graph!.getNode(edge.target)?.qualifiedName)
    );

    const renderOverloads = graph
      .getNodesByName('render')
      .filter((node) => node.qualifiedName === 'codegraph_feature_matrix::render');
    expect(renderOverloads).toHaveLength(2);
    for (const overload of renderOverloads) {
      expect(targetIds.has(overload.id), overload.signature).toBe(true);
    }
    expect(targetQualifiedNames.has('codegraph_feature_matrix::Box::sizeHint')).toBe(true);
    expect(targetQualifiedNames.has('codegraph_feature_matrix::apply')).toBe(true);
    expect(targetQualifiedNames.has('codegraph_feature_matrix::Outcome::Success')).toBe(true);
    expect(targetQualifiedNames.has('codegraph_feature_matrix::Outcome::Failure')).toBe(true);
    expect(targetQualifiedNames.has('codegraph_feature_matrix::中文标识')).toBe(true);

    const operators = graph
      .getNodesByName('operator+')
      .filter((node) => node.qualifiedName === 'codegraph_feature_matrix::Point::operator+');
    expect(operators).toHaveLength(1);
    expect(targetIds.has(operators[0]!.id)).toBe(true);

    const inspectOptional = oneByQualifiedName(
      graph,
      'codegraph_feature_matrix::inspectOptional'
    );
    const optionalTargets = new Set(
      graph
        .getOutgoingEdges(inspectOptional.id)
        .map((edge) => graph!.getNode(edge.target)?.qualifiedName)
    );
    expect(optionalTargets.has('codegraph_feature_matrix::Box::describe')).toBe(true);
    expect(optionalTargets.has('codegraph_feature_matrix::Box::label')).toBe(true);
  }, 120_000);

  it('keeps calls inside spawn and synchronized bodies on their lexical owners', async () => {
    graph = await indexProject('codegraph-concurrency');
    const main = oneByQualifiedName(graph, 'codegraph_concurrency::main');
    const topLevel = oneByQualifiedName(graph, 'codegraph_concurrency::addMany');
    const method = oneByQualifiedName(graph, 'codegraph_concurrency::GuardedCounter::addMany');
    const mainTargets = new Set(
      graph.getOutgoingEdges(main.id).map((edge) => edge.target)
    );
    expect(mainTargets.has(topLevel.id)).toBe(true);
    expect(mainTargets.has(method.id)).toBe(true);

    const guardedMethodTargets = new Set(
      graph
        .getOutgoingEdges(method.id)
        .map((edge) => graph!.getNode(edge.target)?.qualifiedName)
    );
    expect(guardedMethodTargets.has('codegraph_concurrency::addMany')).toBe(false);
  }, 120_000);
});
