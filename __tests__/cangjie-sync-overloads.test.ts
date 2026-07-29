import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeGraph, loadGrammarsForLanguages } from '../src';
import type { Node } from '../src';

let projectDir = '';
let graph: CodeGraph;
const definitionsPath = 'src/defs.cj';

const definitions = (integerType: 'Int64' | 'UInt64', shifted = false): string =>
  `${shifted ? '// force every declaration ID to move\n' : ''}package demo

public func convert(value: ${integerType}): String {
    value.toString()
}

public func convert(value: String): String {
    value
}
`;

function one(qualifiedName: string): Node {
  const name = qualifiedName.split('::').pop()!;
  const matches = graph
    .getNodesByName(name)
    .filter((node) => node.qualifiedName === qualifiedName);
  expect(matches, qualifiedName).toHaveLength(1);
  return matches[0]!;
}

function callTargets(qualifiedName: string): Node[] {
  return graph
    .getOutgoingEdges(one(qualifiedName).id)
    .filter((edge) => edge.kind === 'calls')
    .map((edge) => graph.getNode(edge.target))
    .filter((node): node is Node => node !== null);
}

beforeAll(async () => {
  await loadGrammarsForLanguages(['cangjie']);
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-cangjie-sync-overloads-'));
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, definitionsPath), definitions('Int64'));
  fs.writeFileSync(
    path.join(projectDir, 'src', 'caller.cj'),
    `package demo

public func useInt(): String {
    convert(1)
}

public func useText(): String {
    convert("one")
}
`
  );
  graph = CodeGraph.initSync(projectDir);
  await graph.indexAll();
});

afterAll(() => {
  graph?.destroy();
  if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true });
});

describe('Cangjie overload stability across sync', () => {
  it('preserves overload identity when a callee-only edit shifts node IDs', async () => {
    expect(callTargets('demo::useInt')[0]?.signature).toContain('Int64');
    expect(callTargets('demo::useText')[0]?.signature).toContain('String');

    const intEdge = graph
      .getOutgoingEdges(one('demo::useInt').id)
      .find((edge) => edge.kind === 'calls' && graph.getNode(edge.target)?.name === 'convert');
    expect(intEdge?.metadata?.refCandidates).toEqual([
      '@cangjie/arity=1',
      '@cangjie/type:0=Int64',
    ]);

    fs.writeFileSync(
      path.join(projectDir, definitionsPath),
      definitions('Int64', true)
    );
    const result = await graph.sync({ paths: [definitionsPath] });
    expect(result.filesModified).toBe(1);

    expect(callTargets('demo::useInt')[0]?.signature).toContain('Int64');
    expect(callTargets('demo::useText')[0]?.signature).toContain('String');
  });

  it('resurrects the original call shape when a target changes, then heals it', async () => {
    fs.writeFileSync(
      path.join(projectDir, definitionsPath),
      definitions('UInt64', true)
    );
    await graph.sync({ paths: [definitionsPath] });

    expect(callTargets('demo::useInt').some((node) => node.name === 'convert')).toBe(false);
    expect(callTargets('demo::useText')[0]?.signature).toContain('String');

    fs.writeFileSync(
      path.join(projectDir, definitionsPath),
      definitions('Int64', true)
    );
    await graph.sync({ paths: [definitionsPath] });

    expect(callTargets('demo::useInt')[0]?.signature).toContain('Int64');
    expect(callTargets('demo::useText')[0]?.signature).toContain('String');
  });
});
