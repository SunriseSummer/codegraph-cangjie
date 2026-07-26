import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeGraph, loadGrammarsForLanguages } from '../src';
import type { Edge, Node, NodeKind } from '../src';

let projectDir: string;
let graph: CodeGraph;

function oneNode(name: string, kind: NodeKind, filePath: string): Node {
  const matches = graph
    .getNodesByName(name)
    .filter((node) => node.kind === kind && node.filePath === filePath);
  expect(matches, `${kind} ${name} in ${filePath}`).toHaveLength(1);
  return matches[0]!;
}

function targetsFrom(node: Node, kind: Edge['kind']): Node[] {
  return graph
    .getOutgoingEdges(node.id)
    .filter((edge) => edge.kind === kind)
    .map((edge) => graph.getNode(edge.target))
    .filter((target): target is Node => target !== null);
}

beforeAll(async () => {
  await loadGrammarsForLanguages(['cangjie', 'typescript']);
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-cangjie-resolution-'));
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'src', 'main.cj'),
    `package demo

public interface Painter {
    func paint(): Unit
}

public class PaintDecoy {
    public func paint(): Unit {}
}

public class Canvas {
    public let title: String = "chart"

    public func ownTitle(): String {
        this.title
    }
}

public enum Event {
    | Idle
    | Changed(Int64)
}

public func helper(): Unit {}

public func exercise(canvas: Canvas, painter: Painter): Event {
    helper()
    painter.paint()
    let title = canvas.title
    Event.Changed(1)
}

extend Canvas <: Painter {
    public func paint(): Unit {}
}
`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectDir, 'src', 'decoy.ts'),
    'export function helper(): void {}\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectDir, 'src', 'library.cj'),
    `package demo.lib

public class Gadget {
    public init() {}

    public static func create(): Gadget {
        return Gadget()
    }

    public func ping(): Unit {}
}

public func utility(): Unit {}
`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectDir, 'src', 'imports.cj'),
    `package demo

import demo.lib.Gadget as Renamed
import demo.lib as library

public func exerciseImports(): Unit {
    let gadget = Renamed()
    gadget.ping()
    Renamed.create()
    library.utility()
}
`,
    'utf8',
  );

  graph = CodeGraph.initSync(projectDir);
  await graph.indexAll();
  graph.resolveReferences();
}, 120_000);

afterAll(() => {
  graph?.destroy();
  if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true });
});

describe('Cangjie 1.0.5 reference resolution', () => {
  it('keeps bare calls in the Cangjie package and language', () => {
    const caller = oneNode('exercise', 'function', 'src/main.cj');
    const helper = oneNode('helper', 'function', 'src/main.cj');
    const foreignHelper = oneNode('helper', 'function', 'src/decoy.ts');
    const targets = targetsFrom(caller, 'calls');
    expect(targets.map((target) => target.id)).toContain(helper.id);
    expect(targets.map((target) => target.id)).not.toContain(foreignHelper.id);
  });

  it('uses the declared receiver type instead of a same-named decoy', () => {
    const caller = oneNode('exercise', 'function', 'src/main.cj');
    const painterMethod = graph
      .getNodesByName('paint')
      .find((node) => node.qualifiedName === 'demo::Painter::paint')!;
    const decoy = graph
      .getNodesByName('paint')
      .find((node) => node.qualifiedName === 'demo::PaintDecoy::paint')!;
    const targets = targetsFrom(caller, 'calls');
    expect(targets.map((target) => target.id)).toContain(painterMethod.id);
    expect(targets.map((target) => target.id)).not.toContain(decoy.id);
  });

  it('resolves typed and this-qualified field reads', () => {
    const field = oneNode('title', 'field', 'src/main.cj');
    const exercise = oneNode('exercise', 'function', 'src/main.cj');
    const ownTitle = oneNode('ownTitle', 'method', 'src/main.cj');
    expect(targetsFrom(exercise, 'references').map((target) => target.id)).toContain(field.id);
    expect(targetsFrom(ownTitle, 'references').map((target) => target.id)).toContain(field.id);
  });

  it('resolves enum constructor calls to enum members', () => {
    const caller = oneNode('exercise', 'function', 'src/main.cj');
    const changed = oneNode('Changed', 'enum_member', 'src/main.cj');
    expect(targetsFrom(caller, 'calls').map((target) => target.id)).toContain(changed.id);
  });

  it('models extension ownership and conformance without inventing a type', () => {
    const canvas = oneNode('Canvas', 'class', 'src/main.cj');
    const painter = oneNode('Painter', 'interface', 'src/main.cj');
    const extension = oneNode('Canvas', 'extension', 'src/main.cj');
    const outgoing = graph.getOutgoingEdges(extension.id);
    expect(
      outgoing.some((edge) => edge.kind === 'references' && edge.target === canvas.id),
    ).toBe(true);
    expect(
      outgoing.some((edge) => edge.kind === 'implements' && edge.target === painter.id),
    ).toBe(true);
  });

  it('resolves symbol aliases, aliased static calls, and package aliases', () => {
    const caller = oneNode('exerciseImports', 'function', 'src/imports.cj');
    const gadget = oneNode('Gadget', 'class', 'src/library.cj');
    const create = oneNode('create', 'method', 'src/library.cj');
    const ping = oneNode('ping', 'method', 'src/library.cj');
    const utility = oneNode('utility', 'function', 'src/library.cj');
    const outgoing = graph.getOutgoingEdges(caller.id);
    const targetIds = outgoing.map((edge) => edge.target);

    expect(
      outgoing.some((edge) => edge.kind === 'instantiates' && edge.target === gadget.id),
    ).toBe(true);
    expect(targetIds).toContain(create.id);
    expect(targetIds).toContain(ping.id);
    expect(targetIds).toContain(utility.id);
  });
});
