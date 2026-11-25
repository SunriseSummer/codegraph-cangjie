# Cangjie 1.0.6 executable regression corpus

These small projects are original MIT-licensed regression fixtures for this repository. They cover generic extensions, overloads, enum constructors, Unicode identifiers, optional reads, package aliases and re-exports, concurrency, test macros, and incremental graph parity.

With the official SDK environment loaded, run `cjpm run` in each project and `cjpm test` in `codegraph-sync`. Set `CANGJIE_TEST_TOOLCHAIN=1` to require these compiler checks in the Vitest integration suite. Tests copy fixtures to temporary directories, so build products never enter the source tree.
