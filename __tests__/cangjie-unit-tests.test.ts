import { beforeAll, describe, expect, it } from 'vitest';
import { extractFromSource } from '../src/extraction';
import { loadGrammarsForLanguages } from '../src/extraction/grammars';

const source = `package demo

public func add(left: Int64, right: Int64): Int64 {
    left + right
}

@Types[T in <Int64, UInt64>]
@Test[value in [1, 2]]
func parameterized<T>(value: Int64): Unit {
    @Expect(add(value, 1), value + 1)
}

@Test
class AddTests {
    @BeforeEach
    func setUp(): Unit {}

    @TestCase
    func addsValues(): Unit {
        @Expect(add(2, 3), 5)
    }

    @Bench
    func addBenchmark(): Unit {
        add(2, 3)
    }
}

@TestBuilder
func dynamicTests(): TestSuite {
    TestSuite.builder("dynamic").build()
}
`;

describe('Cangjie *_test.cj extraction', () => {
  beforeAll(async () => {
    await loadGrammarsForLanguages(['cangjie']);
  });

  it('preserves test annotations and production call dependencies', () => {
    const result = extractFromSource('src/add_test.cj', source, 'cangjie');
    expect(result.errors).toEqual([]);

    const byQualifiedName = (qualifiedName: string) =>
      result.nodes.find((node) => node.qualifiedName === qualifiedName);

    expect(byQualifiedName('demo::parameterized')?.decorators)
      .toEqual(['Types', 'Test']);
    expect(byQualifiedName('demo::AddTests')?.decorators)
      .toEqual(['Test']);
    expect(byQualifiedName('demo::AddTests::setUp')?.decorators)
      .toEqual(['BeforeEach']);
    expect(byQualifiedName('demo::AddTests::addsValues')?.decorators)
      .toEqual(['TestCase']);
    expect(byQualifiedName('demo::AddTests::addBenchmark')?.decorators)
      .toEqual(['Bench']);
    expect(byQualifiedName('demo::dynamicTests')?.decorators)
      .toEqual(['TestBuilder']);

    const addCalls = result.unresolvedReferences.filter(
      (ref) => ref.referenceKind === 'calls' && ref.referenceName === 'add'
    );
    expect(addCalls).toHaveLength(3);
    expect(addCalls.map((ref) => ref.fromNodeId).sort()).toEqual(
      [
        byQualifiedName('demo::parameterized')!.id,
        byQualifiedName('demo::AddTests::addsValues')!.id,
        byQualifiedName('demo::AddTests::addBenchmark')!.id,
      ].sort()
    );
  });
});
