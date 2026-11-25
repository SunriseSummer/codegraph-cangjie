# Cangjie 1.0.6 adaptation and validation

Release: `v1.6.4-cangjie-1.0.6.1`  
Branch: `cangjie-1.0.6`  
Base branch commit: `49ad4732609a78002f0dc5ae2ed48b91359f0e56` (`cangjie-1.0.5`)  
Upstream tag: `v1.6.4`, commit `461a5d87a873a4932997cd9a49042ab30e45a675`

The branch preserves the Cangjie fork history and merges the exact upstream
release. It retains the bundled Rust walker and WASM grammar while adopting
upstream's new indexing, resolver, daemon, CLI and Web viewer code.

## Fixes found by the expanded regression suite

1. Bare reads of package constants and function values previously had no graph
   dependency. Both walkers now emit value references after checking lexical
   scope. Parameters, local declarations, lambda parameters, loop bindings,
   match bindings and catch bindings cannot masquerade as same-named globals.
2. Bare recursive calls previously lost their self edge during Cangjie candidate
   filtering. Calls may now resolve to their own function node.
3. A callback parameter or local closure could resolve to a same-named package
   or imported function. Call-shape metadata now carries the local binding and
   bypasses global/import guesses. A statically proven `operator()` remains
   supported.
4. Upstream moved reference resurrection to a shared module. Cangjie overload
   argument types, labels and local-binding hints now survive deletion/retry.
   The change is restricted to Cangjie so other languages retain upstream's
   candidate recomputation behavior.
5. The Cangjie native walker now participates in upstream's parse deadline and
   stack guards. Its block binding lookup is cached per file so repeated value
   reads do not repeatedly scan all declarations of a long function.

## Coverage

| Area | Regression checks |
| --- | --- |
| Functions | Generic constraints, const functions, nested functions, defaults, named arguments, trailing lambdas, overload selection, recursive calls, function values and callback shadowing |
| Types | Classes, interfaces, structs, mutable methods, enums and payloads, generic aliases, function aliases, inheritance, overrides, visibility, extensions, primary constructors, static initialization and finalizers |
| Members | Computed properties, field reads, optional member access, overloaded arithmetic/index/invocation operators, return/field type propagation and chained calls |
| Control flow | Closures, spawn/synchronized, tuple destructuring, optional and enum patterns, loop/match bindings, try/catch/finally and local scope boundaries |
| Packages | Direct/group/wildcard imports, symbol/package aliases, public re-exports, colliding names, private/internal visibility and refusal of unrelated language/package candidates |
| Editing | Callee-only line shifts, overload changes, production/test edits, rollback, deletion/restoration, directory rename and equality of incremental and fresh indexing |
| Text and paths | Unicode identifiers, emoji, paths containing Chinese characters and spaces, LF/CRLF positions, comments/strings resembling calls and unfinished editor buffers |
| Project scale | 80 packages containing 80 same-named `Worker` types in 162 source files; partial sync preserves package-specific callees and matches a fresh index |
| Robustness | Native/WASM semantic parity, normal and 60,000-level nesting, default-sized worker stacks, a native parse deadline and per-file recovery |
| Delivery | TypeScript + viewer build, npm shim/SDK contracts, installer/upgrade behavior, six native target builds, public npm package names/versions and an explicit release commit target |

The 18-case syntax matrix runs with LF and CRLF and compares native/WASM node,
edge and unresolved-reference data. Seventeen ordinary examples also compile as
static libraries with the official compiler; test annotations compile through
the official unit-test runner instead.

Five checked-in projects under `__tests__/fixtures/cangjie-1.0.6/` build and run:
language features, import boundaries, concurrency, production/test sync and
value/callback scope. They replace the earlier developer-local `.test/` corpus
dependencies, so the checks no longer disappear when that directory is absent.

## Reproduction

Use Node 22.12+ or supported Node 24 for development (published bundles include
their runtime). Install Rust to build the native kernel. Source the official
Cangjie SDK's `envsetup.sh` before the compiler checks.

```sh
npm ci
npm run build:kernel
npm run build
CANGJIE_TEST_TOOLCHAIN=1 CODEGRAPH_KERNEL_EXPECT=1 npm test -- --maxWorkers=4
```

The release workflow runs the Cangjie suites on each kernel runner, then the
complete suite with the Linux native kernel and compiler checks before building
or publishing release assets. A failing test blocks publication.

SDK source: [official 1.0.6 download page](https://cangjie-lang.cn/download/1.0.6).  
Linux x64 archive SHA-256:
`47893d081695fd21f8ecf6c4d6b2f6d15109d864576f8857db2556d148e98c7e`.

## Interpretation and limits

These are static source-code analysis checks, not a claim of full compiler
semantics. Runtime reflection, dynamically chosen callbacks and arbitrary macro
expansion cannot always produce a unique static callee. Unknown or ambiguous
targets remain unresolved rather than being guessed. A syntax-recovered file
can fall back to WASM; a recovered graph does not certify that it compiles.
The compiler-backed fixtures separately guard against accepting invalid sample
code merely because tree-sitter recovered it.

After installing this release, run `codegraph index` in existing projects to
rebuild them with extraction version 30.
