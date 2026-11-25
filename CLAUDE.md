# CLAUDE.md

Claude Code project guidance for this repository.

Primary instructions live in the canonical agent guide — import it:

@AGENTS.md

## Claude-only notes

- Prefer the repo-root `AGENTS.md` as the source of truth for build/test/architecture/house rules. Edit that file (not this wrapper) when guidance changes.
- Claude Code can `@`-import nested guides too (e.g. `@docs/AGENTS.md`) when working on design/eval docs; Codex loads nested `AGENTS.md` automatically when the session cwd is under that directory.
- Do not reintroduce a duplicated `## CodeGraph` MCP tool-guidance block here — `src/mcp/server-instructions.ts` is the single source of truth (issue #529); the installer strips legacy marker blocks on upgrade.

## Cangjie distribution

This branch merges upstream v1.6.4 into cangjie-1.0.5 and targets Cangjie SDK 1.0.6 LTS (the 1.0.5 grammar is unchanged). Keep the native Cangjie walker and WASM extraction in parity. Cangjie exact-name resolution preserves package visibility and overload argument hints; these hints must also survive reference resurrection during sync. Use the @cangjie-lang scope and cangjie-1.0.6 branch for installation and release URLs.
