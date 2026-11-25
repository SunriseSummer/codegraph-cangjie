import type { NodeKind } from '../../src/types';

export const CANGJIE_SYNTAX_CASES: Array<{ name: string; source: string; symbols: Array<[NodeKind, string]> }> = [
  { name: 'generic constraints', source: 'public func identity<T>(value: T): T where T <: ToString { value }', symbols: [['function', 'identity']] },
  { name: 'nested functions', source: 'func outer(): Int64 { func inner(): Int64 { 1 }; inner() }', symbols: [['function', 'outer'], ['function', 'inner']] },
  { name: 'constant evaluation', source: 'public const func triple(value: Int64): Int64 { value * 3 }\npublic const TRIPLE = triple(3)', symbols: [['function', 'triple'], ['constant', 'TRIPLE']] },
  { name: 'mutable structs', source: 'public struct Counter { public var value: Int64 = 0; public init() {}; public mut func increment(): Unit { value++ } }', symbols: [['struct', 'Counter'], ['field', 'value'], ['method', 'increment']] },
  { name: 'inheritance and override', source: 'open class Parent { public init() {}; public open func render(): String { "base" } }\nclass Child <: Parent { public init() { super() }; public override func render(): String { super.render() } }', symbols: [['class', 'Parent'], ['class', 'Child'], ['method', 'render']] },
  { name: 'static initialization', source: 'class Config { public static let ready: Int64; static init() { ready = 1 } }', symbols: [['class', 'Config'], ['constant', 'ready'], ['method', 'init']] },
  { name: 'finalizers', source: 'class Resource { public init() {}; ~init() {} }', symbols: [['class', 'Resource'], ['method', '~init']] },
  { name: 'generic type aliases', source: 'public class Cell<T> { public init() {} }\npublic type TextCell = Cell<String>', symbols: [['class', 'Cell'], ['type_alias', 'TextCell']] },
  { name: 'function type aliases', source: 'public type Transform = (Int64) -> Int64', symbols: [['type_alias', 'Transform']] },
  { name: 'enum payloads and matching', source: 'enum Result { Value(Int64) | Missing }\nfunc unpack(result: Result): Int64 { match(result) { case Value(x) => x; case Missing => 0 } }', symbols: [['enum', 'Result'], ['enum_member', 'Value'], ['enum_member', 'Missing'], ['function', 'unpack']] },
  { name: 'mutable computed properties', source: 'class Gauge { private var n: Int64 = 0; public init() {}; public mut prop value: Int64 { get() { n } set(next) { n = next } } }', symbols: [['class', 'Gauge'], ['property', 'value']] },
  { name: 'tuple destructuring', source: 'func pair(): (Int64, String) { (1, "one") }\nfunc unpack(): Unit { let (number, label) = pair(); println(label) }', symbols: [['function', 'pair'], ['function', 'unpack']] },
  { name: 'exception handlers', source: 'func guarded(): Unit { try { throw Exception("probe") } catch (error: Exception) { println(error) } finally { println("done") } }', symbols: [['function', 'guarded']] },
  { name: 'unicode identifiers and strings', source: 'public class 容器 { public init() {}; public func 计算(): String { "😀 hello" } }', symbols: [['class', '容器'], ['method', '计算']] },
  { name: 'comments and strings that resemble calls', source: '// fakeTop()\nfunc actual(): String { /* fakeNested() */ "fakeString()" }', symbols: [['function', 'actual']] },
  { name: 'overloaded index and invoke operators', source: 'class Callable { public init() {}; public operator func [](index: Int64): Int64 { index }; public operator func ()(value: Int64): Int64 { value } }', symbols: [['class', 'Callable'], ['method', 'operator[]'], ['method', 'operator()']] },
  { name: 'test annotations and lifecycle methods', source: '@Test\nclass Examples { @BeforeEach\nfunc prepare(): Unit {}\n@TestCase\nfunc passes(): Unit { @Expect(1, 1) } }', symbols: [['class', 'Examples'], ['method', 'prepare'], ['method', 'passes']] },
  { name: 'foreign function declarations', source: 'foreign func nativeCall(value: Int64): Int64\nfunc invoke(): Int64 { unsafe { nativeCall(1) } }', symbols: [['function', 'nativeCall'], ['function', 'invoke']] },
];
