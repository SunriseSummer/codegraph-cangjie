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

public func addMany(amount: Int64): Unit {}

public func render(value: Int64): String {
    value.toString()
}

public func render(value: String): String {
    value
}

public func format(value: Int64, radix!: Int64 = 10): String {
    value.toString()
}

public func format(value: String): String {
    value
}

public func route(condition: Bool, body: () -> Int64): Int64 {
    body()
}

public func route(condition: String, body: () -> Int64): Int64 {
    body()
}

public func collect(value: Int64): Int64 {
    value
}

public func collect(values: Array<Int64>): Int64 {
    values.size
}

public class PaintDecoy {
    public func paint(): Unit {}
    public func addMany(amount: Int64): Unit {}
}

public class Box<T> {
    public init() {}
}

public class Canvas {
    public let title: String = "chart"

    public prop label: String {
        get() { title }
    }

    public func ownTitle(): String {
        this.title
    }

    public func select(value: Int64): Unit {}
    public func select(value: String): Unit {}

    public operator func +(other: Canvas): Canvas {
        this
    }

    public operator func +(other: Int64): Canvas {
        this
    }

    public operator func [](index: Int64): String {
        title
    }

    public operator func [](index: Int64, value!: String): Unit {}

    public operator func -(): Canvas {
        this
    }

    public operator func ()(scale: Int64): Canvas {
        this
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
    addMany(1)
    let decoy = PaintDecoy()
    decoy.addMany(1)
    let localCanvas = Canvas()
    localCanvas.sizeHint()
    let box = Box<String>()
    box.genericSizeHint()
    let title = canvas.title
    let label = canvas.label
    let combined = canvas + localCanvas
    let shifted = canvas + 1
    let indexed = canvas[0]
    canvas[0] = "updated"
    let negated = -canvas
    let invoked = canvas(2)
    render(1)
    render("chart")
    let number: Int64 = 2
    render(number)
    format(1)
    format(1, radix: 16)
    format("chart")
    route(true) { 1 }
    route("yes") { 2 }
    collect(1)
    collect(1, 2, 3)
    canvas.select(1)
    canvas.select("chart")
    Event.Changed(1)
}

extend Canvas <: Painter {
    public func paint(): Unit {}
    public func sizeHint(): Int64 { 1 }
}

extend<T> Box<T> {
    public func genericSizeHint(): Int64 { 1 }
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

import demo.hidden.HiddenReturn

public class Gadget {
    public init() {}

    public static func create(): Gadget {
        return Gadget()
    }

    public func ping(): Unit {}
}

public class Tool {
    public init() {}

    public static func build(): Tool {
        Tool()
    }

    public func ping(): Unit {}
}

public class Reexported {
    public init() {}

    public static func build(): Reexported {
        Reexported()
    }

    public func ping(): Unit {}
}

public class Producer {
    public static func make(): HiddenReturn {
        HiddenReturn()
    }
}

public class ImportedChild <: HiddenReturn {
    public init() {
        super()
    }
}

public func utility(): Unit {}
protected func moduleUtility(): Unit {}
internal func internalUtility(): Unit {}
private func privateUtility(): Unit {}
`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectDir, 'src', 'hidden.cj'),
    `package demo.hidden

public open class HiddenReturn {
    public init() {}
    public func ping(): Unit {}
}
`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectDir, 'src', 'facade.cj'),
    `package demo.facade

public import demo.lib.Reexported
`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectDir, 'src', 'other.cj'),
    `package demo.other

public class Reexported {
    public init() {}

    public static func build(): Reexported {
        Reexported()
    }

    public func ping(): Unit {}
}
`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectDir, 'src', 'imports.cj'),
    `package demo

import demo.lib.Gadget as Renamed
import demo.lib.{Tool}
import demo.facade.{Reexported}
import demo.lib as library
import demo.lib.Producer
import demo.lib.ImportedChild
import demo.lib.moduleUtility
import demo.lib.privateUtility

public func exerciseImports(): Unit {
    let gadget = Renamed()
    gadget.ping()
    Renamed.create()
    Renamed.create().ping()
    Tool.build().ping()
    Reexported.build().ping()
    Producer.make().ping()
    ImportedChild().ping()
    library.utility()
    moduleUtility()
    privateUtility()
}
`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectDir, 'src', 'child.cj'),
    `package demo.lib.child

import demo.lib.internalUtility

public func exerciseInternalImport(): Unit {
    internalUtility()
}
`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectDir, 'src', 'chains.cj'),
    `package demo

public class Leaf {
    public static let regular = Leaf()
    public init() {}
    public func ping(): Unit {}
}

public class GenericBox<T> {
    public GenericBox(public let value: T) {}

    public func get(): T {
        value
    }
}

public open class BaseWorker {
    protected let inheritedLeaf: Leaf = Leaf()
    public init() {}
    public func inherited(): Unit {}
}

public class ChildWorker <: BaseWorker {
    public init() {
        super()
    }

    public func run(): Unit {
        super.inherited()
        inheritedLeaf.ping()
    }
}

public enum Mode {
    | Fast
    | Tuned(Int64)

    public func execute(): Unit {}
}

public class MenuItem {
    let action: () -> Unit
    public init() {}
    public func activate(): Unit {}
}

public class ItemShelf {
    public init() {}
    public operator func [](index: Int64): MenuItem { MenuItem() }
}

public class LambdaBuilder {
    public init(body: () -> Int64) { body() }
    public func configure(value: Int64): LambdaBuilder { this }
}

public func currentItems(): Array<MenuItem> {
    [MenuItem()]
}

public class lowercase {
    public init() {}
}

public func Uppercase(): Unit {}

public func exerciseIdentifierCase(): Unit {
    let value = lowercase()
    Uppercase()
}

public class Factory {
    public let leaf: Leaf = Leaf()

    public init() {}

    public func make(): Leaf {
        Leaf()
    }

    public func leaves(): Array<Leaf> {
        [Leaf()]
    }
}

public func makeLeaf(): Leaf {
    Leaf()
}

public func exerciseChains(factory: Factory): Unit {
    factory.make().ping()
    makeLeaf().ping()
    let inferred = makeLeaf()
    inferred.ping()
    factory.leaf.ping()
    let chained = Factory().make()
    chained.ping()
    for (leaf in factory.leaves()) {
        leaf.ping()
    }
    Leaf.regular.ping()
    let regular = Leaf.regular
    regular.ping()
    let generic: GenericBox<Leaf> = GenericBox<Leaf>(Leaf())
    generic.get().ping()
    generic.value.ping()
}

public func exerciseInheritedReceiver(worker: ChildWorker): Unit {
    worker.inherited()
}

public func exerciseEnumMemberChains(): Unit {
    Mode.Fast.execute()
    Mode.Tuned(1).execute()
    let selected = Mode.Fast
    selected.execute()
    let modes = [
        Mode.Fast,
        Mode.Tuned(2)
    ]
    for (mode in modes) {
        mode.execute()
    }
}

public func exerciseIndexedReceivers(): Unit {
    let items: Array<MenuItem> = [MenuItem()]
    items[0].activate()
    items[0].action()
    currentItems()[0].activate()
    let shelf = ItemShelf()
    shelf[0].activate()
}

public class TupleMaker {
    public static func createPair(): (Factory, Leaf) {
        (Factory(), Leaf())
    }
}

public func exerciseTupleDestructuring(): Unit {
    let (factory, leaf) = TupleMaker.createPair()
    factory.make().ping()
    leaf.ping()
}

public func maybeLeaf(): ?Leaf {
    Some(Leaf())
}

public func exerciseNamedParameter(value!: Leaf = Leaf()): Unit {
    value.ping()
}

public class OptionalPair {
    public let first: ?Leaf
    public let second: ?Factory
    public init() {}
}

public func exerciseTupleMatch(options!: OptionalPair = OptionalPair()): Unit {
    match ((options.first, options.second)) {
        case (Some(leaf), Some(_)) => leaf.ping()
        case _ => ()
    }
}

public func maybePair(): ?(Leaf, Factory) {
    Some((Leaf(), Factory()))
}

public func exerciseMatchResultTyping(): Unit {
    let selected = match (maybeLeaf()) {
        case Some(value) => value
        case None => Leaf()
    }
    selected.ping()
}

public func exerciseMatchBindingTyping(): Unit {
    match (maybeLeaf()) {
        case Some(value) => value.ping()
        case None => ()
    }
    match (maybePair()) {
        case Some((leaf, _)) => leaf.ping()
        case None => ()
    }
}

public func exerciseTrailingLambdaReceiver(): Unit {
    LambdaBuilder() { 1 }.configure(2)
}
`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectDir, 'src', 'local-a.cj'),
    `package demo

private func localOnly(): Unit {}
private class LocalProbe {}

public func exerciseLocalA(): Unit {
    localOnly()
    LocalProbe()
}
`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectDir, 'src', 'local-b.cj'),
    `package demo

private func localOnly(): Unit {}
private class LocalProbe {}

public func exerciseLocalB(): Unit {
    localOnly()
    LocalProbe()
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

  it('keeps bare top-level calls separate from same-named methods', () => {
    const caller = oneNode('exercise', 'function', 'src/main.cj');
    const topLevel = oneNode('addMany', 'function', 'src/main.cj');
    const method = oneNode('addMany', 'method', 'src/main.cj');
    const targetIds = targetsFrom(caller, 'calls').map((target) => target.id);
    expect(targetIds).toContain(topLevel.id);
    expect(targetIds).toContain(method.id);
  });

  it('resolves calls to members declared by a generic-compatible extension', () => {
    const caller = oneNode('exercise', 'function', 'src/main.cj');
    const sizeHint = oneNode('sizeHint', 'method', 'src/main.cj');
    const genericSizeHint = oneNode('genericSizeHint', 'method', 'src/main.cj');
    const targetIds = targetsFrom(caller, 'calls').map((target) => target.id);
    expect(targetIds).toContain(sizeHint.id);
    expect(targetIds).toContain(genericSizeHint.id);
  });

  it('distinguishes overloaded calls using their argument shapes', () => {
    const caller = oneNode('exercise', 'function', 'src/main.cj');
    const overloads = graph
      .getNodesByName('render')
      .filter((node) => node.kind === 'function' && node.filePath === 'src/main.cj');
    expect(overloads).toHaveLength(2);
    const targetIds = new Set(targetsFrom(caller, 'calls').map((target) => target.id));
    expect(targetIds.has(overloads.find((node) => node.signature?.includes('Int64'))!.id)).toBe(true);
    expect(targetIds.has(overloads.find((node) => node.signature?.includes('String'))!.id)).toBe(true);
  });

  it('handles defaults, named arguments, trailing lambdas, and variadic overloads', () => {
    const caller = oneNode('exercise', 'function', 'src/main.cj');
    const targetIds = new Set(targetsFrom(caller, 'calls').map((target) => target.id));
    for (const name of ['format', 'route', 'collect']) {
      const overloads = graph
        .getNodesByName(name)
        .filter((node) => node.kind === 'function' && node.filePath === 'src/main.cj');
      expect(overloads, name).toHaveLength(2);
      for (const overload of overloads) expect(targetIds.has(overload.id), overload.signature).toBe(true);
    }
  });

  it('distinguishes method overloads using the receiver and argument type', () => {
    const caller = oneNode('exercise', 'function', 'src/main.cj');
    const targetIds = new Set(targetsFrom(caller, 'calls').map((target) => target.id));
    const overloads = graph
      .getNodesByName('select')
      .filter((node) => node.kind === 'method' && node.filePath === 'src/main.cj');
    expect(overloads).toHaveLength(2);
    for (const overload of overloads) expect(targetIds.has(overload.id), overload.signature).toBe(true);
  });

  it('resolves typed and this-qualified field reads', () => {
    const field = oneNode('title', 'field', 'src/main.cj');
    const property = oneNode('label', 'property', 'src/main.cj');
    const exercise = oneNode('exercise', 'function', 'src/main.cj');
    const ownTitle = oneNode('ownTitle', 'method', 'src/main.cj');
    expect(targetsFrom(exercise, 'references').map((target) => target.id)).toContain(field.id);
    expect(targetsFrom(exercise, 'references').map((target) => target.id)).toContain(property.id);
    expect(targetsFrom(ownTitle, 'references').map((target) => target.id)).toContain(field.id);
  });

  it('models overloaded operator expressions as calls', () => {
    const caller = oneNode('exercise', 'function', 'src/main.cj');
    const targetIds = new Set(targetsFrom(caller, 'calls').map((target) => target.id));
    const overloads = graph
      .getNodesByName('operator+')
      .filter((node) => node.kind === 'method' && node.filePath === 'src/main.cj');
    expect(overloads).toHaveLength(2);
    for (const overload of overloads) expect(targetIds.has(overload.id), overload.signature).toBe(true);

    const indexOperators = graph
      .getNodesByName('operator[]')
      .filter(
        (node) => node.kind === 'method' && node.filePath === 'src/main.cj'
      );
    expect(indexOperators).toHaveLength(2);
    for (const operator of indexOperators) {
      expect(targetIds.has(operator.id), operator.signature).toBe(true);
    }

    for (const name of ['operator-', 'operator()']) {
      const operator = oneNode(name, 'method', 'src/main.cj');
      expect(targetIds.has(operator.id), name).toBe(true);
    }
  });

  it('resolves enum constructor calls to enum members', () => {
    const caller = oneNode('exercise', 'function', 'src/main.cj');
    const changed = oneNode('Changed', 'enum_member', 'src/main.cj');
    expect(targetsFrom(caller, 'instantiates').map((target) => target.id)).toContain(
      changed.id
    );
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
    const packageNode = oneNode('demo', 'namespace', 'src/imports.cj');
    const gadget = oneNode('Gadget', 'class', 'src/library.cj');
    const tool = oneNode('Tool', 'class', 'src/library.cj');
    const reexported = oneNode('Reexported', 'class', 'src/library.cj');
    const create = oneNode('create', 'method', 'src/library.cj');
    const ping = graph
      .getNodesByName('ping')
      .find((node) => node.qualifiedName === 'demo.lib::Gadget::ping')!;
    const utility = oneNode('utility', 'function', 'src/library.cj');
    const moduleUtility = oneNode(
      'moduleUtility',
      'function',
      'src/library.cj'
    );
    const privateUtility = oneNode(
      'privateUtility',
      'function',
      'src/library.cj'
    );
    const toolBuild = graph
      .getNodesByName('build')
      .find((node) => node.qualifiedName === 'demo.lib::Tool::build')!;
    const reexportedBuild = graph
      .getNodesByName('build')
      .find((node) => node.qualifiedName === 'demo.lib::Reexported::build')!;
    const toolPing = graph
      .getNodesByName('ping')
      .find((node) => node.qualifiedName === 'demo.lib::Tool::ping')!;
    const reexportedPing = graph
      .getNodesByName('ping')
      .find((node) => node.qualifiedName === 'demo.lib::Reexported::ping')!;
    const hiddenPing = graph
      .getNodesByName('ping')
      .find((node) => node.qualifiedName === 'demo.hidden::HiddenReturn::ping')!;
    const unrelatedBuild = graph
      .getNodesByName('build')
      .find((node) => node.qualifiedName === 'demo.other::Reexported::build')!;
    const outgoing = graph.getOutgoingEdges(caller.id);
    const targetIds = outgoing.map((edge) => edge.target);

    expect(
      outgoing.some((edge) => edge.kind === 'instantiates' && edge.target === gadget.id),
    ).toBe(true);
    expect(targetIds).toContain(create.id);
    expect(targetIds.filter((id) => id === ping.id)).toHaveLength(2);
    expect(targetIds).toContain(toolBuild.id);
    expect(targetIds).toContain(reexportedBuild.id);
    expect(targetIds).toContain(toolPing.id);
    expect(targetIds).toContain(reexportedPing.id);
    expect(targetIds.filter((id) => id === hiddenPing.id)).toHaveLength(2);
    expect(targetIds).not.toContain(unrelatedBuild.id);
    expect(targetIds).toContain(utility.id);
    expect(targetIds).toContain(moduleUtility.id);
    expect(targetIds).not.toContain(privateUtility.id);
    const importTargetIds = targetsFrom(packageNode, 'imports').map(
      (target) => target.id
    );
    expect(importTargetIds).toContain(gadget.id);
    expect(importTargetIds).toContain(tool.id);
    expect(importTargetIds).toContain(reexported.id);
    expect(importTargetIds).toContain(moduleUtility.id);
    expect(importTargetIds).not.toContain(privateUtility.id);
    const internalCaller = oneNode(
      'exerciseInternalImport',
      'function',
      'src/child.cj'
    );
    const internalUtility = oneNode(
      'internalUtility',
      'function',
      'src/library.cj'
    );
    expect(
      targetsFrom(internalCaller, 'calls').map((target) => target.id)
    ).toContain(internalUtility.id);
  });

  it('propagates declared return and field types through call chains', () => {
    const caller = oneNode('exerciseChains', 'function', 'src/chains.cj');
    const make = oneNode('make', 'method', 'src/chains.cj');
    const makeLeaf = oneNode('makeLeaf', 'function', 'src/chains.cj');
    const ping = oneNode('ping', 'method', 'src/chains.cj');
    const leaf = oneNode('leaf', 'field', 'src/chains.cj');
    const value = oneNode('value', 'field', 'src/chains.cj');
    const outgoing = graph.getOutgoingEdges(caller.id);
    const targetIds = outgoing.map((edge) => edge.target);

    expect(targetIds).toContain(make.id);
    expect(targetIds).toContain(makeLeaf.id);
    expect(targetIds.filter((id) => id === ping.id)).toHaveLength(10);
    expect(targetIds).toContain(leaf.id);
    expect(targetIds).toContain(value.id);
  });

  it('resolves super constructor and method calls against the superclass', () => {
    const baseInit = graph
      .getNodesByName('init')
      .find(
        (node) =>
          node.qualifiedName === 'demo::BaseWorker::init' &&
          node.filePath === 'src/chains.cj'
      )!;
    const childInit = graph
      .getNodesByName('init')
      .find(
        (node) =>
          node.qualifiedName === 'demo::ChildWorker::init' &&
          node.filePath === 'src/chains.cj'
      )!;
    const inherited = oneNode('inherited', 'method', 'src/chains.cj');
    const ping = oneNode('ping', 'method', 'src/chains.cj');
    const run = oneNode('run', 'method', 'src/chains.cj');

    expect(targetsFrom(childInit, 'calls').map((node) => node.id)).toContain(
      baseInit.id
    );
    expect(targetsFrom(run, 'calls').map((node) => node.id)).toContain(
      inherited.id
    );
    expect(targetsFrom(run, 'calls').map((node) => node.id)).toContain(ping.id);
  });

  it('resolves inherited methods on ordinary child-typed receivers', () => {
    const caller = oneNode(
      'exerciseInheritedReceiver',
      'function',
      'src/chains.cj'
    );
    const inherited = oneNode('inherited', 'method', 'src/chains.cj');
    expect(targetsFrom(caller, 'calls').map((node) => node.id)).toContain(
      inherited.id
    );
  });

  it('propagates enum-member value types through method chains', () => {
    const caller = oneNode(
      'exerciseEnumMemberChains',
      'function',
      'src/chains.cj'
    );
    const execute = oneNode('execute', 'method', 'src/chains.cj');
    expect(
      targetsFrom(caller, 'calls').filter((node) => node.id === execute.id)
    ).toHaveLength(4);
  });

  it('propagates array and operator-index element types through call chains', () => {
    const caller = oneNode(
      'exerciseIndexedReceivers',
      'function',
      'src/chains.cj'
    );
    const activate = oneNode('activate', 'method', 'src/chains.cj');
    const action = oneNode('action', 'field', 'src/chains.cj');
    expect(
      targetsFrom(caller, 'calls').filter((node) => node.id === activate.id)
    ).toHaveLength(3);
    expect(
      targetsFrom(caller, 'calls').filter((node) => node.id === action.id)
    ).toHaveLength(1);
  });

  it('propagates a constructor type through a trailing-lambda call chain', () => {
    const caller = oneNode(
      'exerciseTrailingLambdaReceiver',
      'function',
      'src/chains.cj'
    );
    const configure = oneNode('configure', 'method', 'src/chains.cj');
    expect(targetsFrom(caller, 'calls').map((node) => node.id)).toContain(
      configure.id
    );
  });

  it('propagates tuple-return element types through destructuring', () => {
    const caller = oneNode(
      'exerciseTupleDestructuring',
      'function',
      'src/chains.cj'
    );
    const make = graph
      .getNodesByName('make')
      .find((node) => node.qualifiedName === 'demo::Factory::make')!;
    const ping = oneNode('ping', 'method', 'src/chains.cj');
    const targets = targetsFrom(caller, 'calls');
    expect(targets.map((node) => node.id)).toContain(make.id);
    expect(targets.filter((node) => node.id === ping.id)).toHaveLength(2);
  });

  it('propagates optional element types through match expressions', () => {
    const ping = oneNode('ping', 'method', 'src/chains.cj');
    for (const name of [
      'exerciseMatchResultTyping',
      'exerciseMatchBindingTyping',
    ]) {
      const caller = oneNode(name, 'function', 'src/chains.cj');
      expect(
        targetsFrom(caller, 'calls').filter((node) => node.id === ping.id),
        name
      ).toHaveLength(name === 'exerciseMatchBindingTyping' ? 2 : 1);
    }
  });

  it('infers the types of named parameters', () => {
    const caller = oneNode(
      'exerciseNamedParameter',
      'function',
      'src/chains.cj'
    );
    const ping = oneNode('ping', 'method', 'src/chains.cj');
    expect(targetsFrom(caller, 'calls').map((node) => node.id)).toContain(
      ping.id
    );
  });

  it('infers nested optional bindings in tuple match patterns', () => {
    const caller = oneNode(
      'exerciseTupleMatch',
      'function',
      'src/chains.cj'
    );
    const ping = oneNode('ping', 'method', 'src/chains.cj');
    expect(targetsFrom(caller, 'calls').map((node) => node.id)).toContain(
      ping.id
    );
  });

  it('prefers a same-file private function over duplicate package-local names', () => {
    for (const suffix of ['A', 'B']) {
      const filePath = `src/local-${suffix.toLowerCase()}.cj`;
      const caller = oneNode(`exerciseLocal${suffix}`, 'function', filePath);
      const local = oneNode('localOnly', 'function', filePath);
      const localProbe = oneNode('LocalProbe', 'class', filePath);
      const other = oneNode(
        'localOnly',
        'function',
        suffix === 'A' ? 'src/local-b.cj' : 'src/local-a.cj'
      );
      const targets = targetsFrom(caller, 'calls').map((node) => node.id);
      expect(targets).toContain(local.id);
      expect(targets).not.toContain(other.id);
      expect(targetsFrom(caller, 'instantiates').map((node) => node.id)).toContain(
        localProbe.id
      );
    }
  });

  it('classifies calls from symbols instead of identifier capitalization', () => {
    const caller = oneNode(
      'exerciseIdentifierCase',
      'function',
      'src/chains.cj'
    );
    const lowercase = oneNode('lowercase', 'class', 'src/chains.cj');
    const uppercase = oneNode('Uppercase', 'function', 'src/chains.cj');

    expect(
      targetsFrom(caller, 'instantiates').map((node) => node.id)
    ).toContain(lowercase.id);
    expect(targetsFrom(caller, 'calls').map((node) => node.id)).toContain(
      uppercase.id
    );
  });
});
