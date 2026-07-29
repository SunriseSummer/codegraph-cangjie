import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeGraph, loadGrammarsForLanguages } from '../src';
import type { Edge, Node } from '../src';
import { ToolHandler } from '../src/mcp/tools';

type GraphSnapshot = {
  nodes: string[];
  edges: string[];
};

const definitions = (withProbe = false): string => `package syncdemo

${withProbe ? 'public func unrelatedProbe(): Unit {}\n\n' : ''}public interface Describable {
    func describe(): String
}

public class Box <: Describable {
    public init() {}

    public func describe(): String {
        "box"
    }
}
`;

const caller = (
  receiverType: 'Describable' | 'Box' = 'Describable',
  withSuffix = false
): string => `package syncdemo

public func render(box: Box): String {
    let value: ${receiverType} = box
    value.describe()${withSuffix ? ' + suffix()' : ''}
}
`;

const testSource = (expected = '"box"', tagged = false): string => `package syncdemo

@Test
func renderTest(): Unit {
    @Expect(render(Box()), ${expected})
}

@Test
class RenderTests {
    @BeforeEach
    func setUp(): Unit {}

    ${tagged ? '@Tag["sync"]\n    ' : ''}@TestCase
    func describesBox(): Unit {
        @Expect(render(Box()), ${expected})
    }
}
`;

function nodeIdentity(node: Node): string {
  return JSON.stringify({
    kind: node.kind,
    qualifiedName: node.qualifiedName,
    filePath: node.filePath,
    startLine: node.startLine,
    endLine: node.endLine,
    signature: node.signature,
    visibility: node.visibility,
    isExported: node.isExported,
    decorators: node.decorators,
    typeParameters: node.typeParameters,
    returnType: node.returnType,
  });
}

function snapshot(graph: CodeGraph): GraphSnapshot {
  const nodes = graph
    .getFiles()
    .flatMap((file) => graph.getNodesInFile(file.path));
  const identities = new Map(nodes.map((node) => [node.id, nodeIdentity(node)]));
  const edgeIdentity = (edge: Edge): string => JSON.stringify({
    source: identities.get(edge.source),
    target: identities.get(edge.target),
    kind: edge.kind,
    line: edge.line,
    column: edge.column,
    metadata: edge.metadata,
    provenance: edge.provenance,
  });
  return {
    nodes: nodes.map(nodeIdentity).sort(),
    edges: nodes
      .flatMap((node) => graph.getOutgoingEdges(node.id))
      .map(edgeIdentity)
      .sort(),
  };
}

function one(graph: CodeGraph, qualifiedName: string): Node {
  const simpleName = qualifiedName.split('::').pop()!;
  const matches = graph
    .getNodesByName(simpleName)
    .filter((node) => node.qualifiedName === qualifiedName);
  expect(matches, qualifiedName).toHaveLength(1);
  return matches[0]!;
}

function callTarget(graph: CodeGraph, callerName: string, targetName: string): Node | undefined {
  return graph
    .getOutgoingEdges(one(graph, callerName).id)
    .filter((edge) => edge.kind === 'calls')
    .map((edge) => graph.getNode(edge.target))
    .find((node): node is Node => node?.name === targetName);
}

describe('Cangjie incremental sync parity', () => {
  let projectDir = '';
  let graph: CodeGraph;

  beforeAll(async () => {
    await loadGrammarsForLanguages(['cangjie']);
  });

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-cangjie-sync-parity-'));
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'src', 'definitions.cj'), definitions());
    fs.writeFileSync(path.join(projectDir, 'src', 'caller.cj'), caller());
    graph = CodeGraph.initSync(projectDir);
    await graph.indexAll();
  });

  afterEach(() => {
    graph?.destroy();
    if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true });
  });

  async function expectSyncParity(paths?: string[]): Promise<void> {
    await graph.sync(paths ? { paths } : undefined);
    const incremental = snapshot(graph);
    await graph.indexAll();
    expect(snapshot(graph)).toEqual(incremental);
  }

  it('does not retarget an interface call to a same-signature implementation', async () => {
    expect(callTarget(graph, 'syncdemo::render', 'describe')?.qualifiedName)
      .toBe('syncdemo::Describable::describe');

    fs.writeFileSync(
      path.join(projectDir, 'src', 'definitions.cj'),
      definitions(true)
    );
    await expectSyncParity(['src/definitions.cj']);

    expect(callTarget(graph, 'syncdemo::render', 'describe')?.qualifiedName)
      .toBe('syncdemo::Describable::describe');
  });

  it('keeps the same sync/full parity on the WASM extraction path', async () => {
    const previous = process.env.CODEGRAPH_KERNEL;
    process.env.CODEGRAPH_KERNEL = '0';
    try {
      await graph.indexAll();
      fs.writeFileSync(
        path.join(projectDir, 'src', 'definitions.cj'),
        definitions(true)
      );
      await expectSyncParity(['src/definitions.cj']);
      expect(callTarget(graph, 'syncdemo::render', 'describe')?.qualifiedName)
        .toBe('syncdemo::Describable::describe');
    } finally {
      if (previous === undefined) delete process.env.CODEGRAPH_KERNEL;
      else process.env.CODEGRAPH_KERNEL = previous;
    }
  });

  it('matches a full index through source and *_test.cj mutation sequences', async () => {
    // Callee-only line shifts, including the duplicate method identity above.
    fs.writeFileSync(path.join(projectDir, 'src', 'definitions.cj'), definitions(true));
    await expectSyncParity(['src/definitions.cj']);
    fs.writeFileSync(path.join(projectDir, 'src', 'definitions.cj'), definitions());
    await expectSyncParity();

    // Caller-only static receiver changes must rebind in both directions.
    fs.writeFileSync(path.join(projectDir, 'src', 'caller.cj'), caller('Box'));
    await expectSyncParity(['src/caller.cj']);
    expect(callTarget(graph, 'syncdemo::render', 'describe')?.qualifiedName)
      .toBe('syncdemo::Box::describe');
    fs.writeFileSync(path.join(projectDir, 'src', 'caller.cj'), caller());
    await expectSyncParity(['src/caller.cj']);

    // Add a standard Cangjie unit-test file with both supported test shapes.
    fs.writeFileSync(path.join(projectDir, 'src', 'render_test.cj'), testSource());
    await expectSyncParity(['src/render_test.cj']);
    expect(graph.getFileDependents('src/caller.cj')).toContain('src/render_test.cj');

    // Simultaneous production + test edits exercise the watcher scoped path.
    fs.writeFileSync(path.join(projectDir, 'src', 'definitions.cj'), definitions(true));
    fs.writeFileSync(
      path.join(projectDir, 'src', 'render_test.cj'),
      testSource('Box().describe()', true)
    );
    await expectSyncParity(['src/definitions.cj', 'src/render_test.cj']);
    expect(one(graph, 'syncdemo::RenderTests::describesBox').decorators)
      .toEqual(['Tag', 'TestCase']);

    // Add a new callee and caller ref together, then move/remove/restore the
    // callee while both the caller and its tests stay unchanged.
    fs.writeFileSync(
      path.join(projectDir, 'src', 'suffix.cj'),
      'package syncdemo\n\npublic func suffix(): String { "!" }\n'
    );
    fs.writeFileSync(path.join(projectDir, 'src', 'caller.cj'), caller('Describable', true));
    await expectSyncParity(['src/suffix.cj', 'src/caller.cj']);
    expect(callTarget(graph, 'syncdemo::render', 'suffix')?.filePath).toBe('src/suffix.cj');

    fs.renameSync(
      path.join(projectDir, 'src', 'suffix.cj'),
      path.join(projectDir, 'src', 'moved.cj')
    );
    await expectSyncParity(['src/suffix.cj', 'src/moved.cj']);
    expect(callTarget(graph, 'syncdemo::render', 'suffix')?.filePath).toBe('src/moved.cj');

    fs.unlinkSync(path.join(projectDir, 'src', 'moved.cj'));
    await expectSyncParity(['src/moved.cj']);
    expect(callTarget(graph, 'syncdemo::render', 'suffix')).toBeUndefined();

    fs.writeFileSync(
      path.join(projectDir, 'src', 'restored.cj'),
      'package syncdemo\n\npublic func suffix(): String { "!" }\n'
    );
    await expectSyncParity(['src/restored.cj']);
    expect(callTarget(graph, 'syncdemo::render', 'suffix')?.filePath).toBe('src/restored.cj');

    // Rename and delete the test file: removed rows/edges must not survive.
    fs.renameSync(
      path.join(projectDir, 'src', 'render_test.cj'),
      path.join(projectDir, 'src', 'box_test.cj')
    );
    await expectSyncParity(['src/render_test.cj', 'src/box_test.cj']);
    expect(graph.getFiles().map((file) => file.path)).not.toContain('src/render_test.cj');
    expect(graph.getFiles().map((file) => file.path)).toContain('src/box_test.cj');
    const handler = new ToolHandler(graph);
    const callers = await handler.execute('codegraph_callers', { symbol: 'render' });
    const callersText = callers.content[0]?.text ?? '';
    expect(callersText).toContain('src/box_test.cj');
    expect(callersText).not.toContain('src/render_test.cj');
    const testCase = await handler.execute('codegraph_node', {
      symbol: 'describesBox',
      file: 'src/box_test.cj',
    });
    expect(testCase.content[0]?.text ?? '').toContain('@Tag, @TestCase');

    fs.unlinkSync(path.join(projectDir, 'src', 'box_test.cj'));
    await expectSyncParity(['src/box_test.cj']);
    expect(graph.getFileDependents('src/caller.cj')).not.toContain('src/box_test.cj');
  }, 15_000);
});
