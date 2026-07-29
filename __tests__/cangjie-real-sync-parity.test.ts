import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeGraph, loadGrammarsForLanguages } from '../src';
import type { Edge, Node } from '../src';
import { ToolHandler } from '../src/mcp/tools';

const CORPUS_ROOT = path.resolve(__dirname, '..', '..', '.test', 'plotmore');
const corpusAvailable = fs.existsSync(path.join(CORPUS_ROOT, 'src', 'core', 'scale.cj'));

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

function nodeKey(node: Node): string {
  return JSON.stringify({
    kind: node.kind,
    qualifiedName: node.qualifiedName,
    filePath: node.filePath,
    startLine: node.startLine,
    endLine: node.endLine,
    signature: node.signature,
    visibility: node.visibility,
    decorators: node.decorators,
  });
}

function graphSnapshot(graph: CodeGraph): { nodes: string[]; edges: string[] } {
  const nodes = graph.getFiles().flatMap((file) => graph.getNodesInFile(file.path));
  const identities = new Map(nodes.map((node) => [node.id, nodeKey(node)]));
  const edgeKey = (edge: Edge): string => JSON.stringify({
    source: identities.get(edge.source),
    target: identities.get(edge.target),
    kind: edge.kind,
    line: edge.line,
    column: edge.column,
    metadata: edge.metadata,
    provenance: edge.provenance,
  });
  return {
    nodes: nodes.map(nodeKey).sort(),
    edges: nodes.flatMap((node) => graph.getOutgoingEdges(node.id)).map(edgeKey).sort(),
  };
}

describe.skipIf(!corpusAvailable)('Cangjie real-project sync parity', () => {
  let temporaryRoot = '';
  let graph: CodeGraph;

  beforeAll(async () => {
    await loadGrammarsForLanguages(['cangjie']);
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-plotmore-sync-'));
    copySourceTree(CORPUS_ROOT, temporaryRoot);
    graph = CodeGraph.initSync(temporaryRoot);
    await graph.indexAll();
  }, 120_000);

  afterAll(() => {
    graph?.destroy();
    if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it('matches full indexing after simultaneous production/test line shifts and rollback', async () => {
    const productionPath = path.join(temporaryRoot, 'src', 'core', 'scale.cj');
    const testPath = path.join(temporaryRoot, 'src', 'core', 'scale_test.cj');
    const originalProduction = fs.readFileSync(productionPath, 'utf8');
    const originalTest = fs.readFileSync(testPath, 'utf8');
    const paths = ['src/core/scale.cj', 'src/core/scale_test.cj'];

    fs.writeFileSync(productionPath, `// incremental parity probe\n${originalProduction}`);
    fs.writeFileSync(testPath, `// incremental parity probe\n${originalTest}`);
    const shifted = await graph.sync({ paths });
    expect(shifted.filesModified).toBe(2);
    const incrementalShifted = graphSnapshot(graph);

    // An MCP client querying immediately after sync must see the new test
    // locations and test annotation, before any full rebuild occurs.
    const handler = new ToolHandler(graph);
    const callers = await handler.execute('codegraph_callers', {
      symbol: 'normalize',
      file: 'src/core/scale.cj',
    });
    expect(callers.content[0]?.text ?? '').toContain('src/core/scale_test.cj');
    const testNode = await handler.execute('codegraph_node', {
      symbol: 'linearScaleNormalizesProportionally',
      file: 'src/core/scale_test.cj',
    });
    const testText = testNode.content[0]?.text ?? '';
    expect(testText).toContain('src/core/scale_test.cj:7');
    expect(testText).toContain('**Decorators:** @Test');

    await graph.indexAll();
    expect(graphSnapshot(graph)).toEqual(incrementalShifted);

    fs.writeFileSync(productionPath, originalProduction);
    fs.writeFileSync(testPath, originalTest);
    const restored = await graph.sync({ paths });
    expect(restored.filesModified).toBe(2);
    const incrementalRestored = graphSnapshot(graph);
    await graph.indexAll();
    expect(graphSnapshot(graph)).toEqual(incrementalRestored);
  }, 120_000);
});
