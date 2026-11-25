/**
 * Resolved package version, computed once at module load.
 *
 * The version string is the rendezvous datum between cooperating daemon and
 * proxy processes: the daemon advertises its version in the hello line, and
 * the proxy refuses to share IPC across a mismatch (falls back to direct
 * mode), or replaces a daemon of an older release ({@link isOlderRelease}).
 * Keeping the resolution in one place avoids drift between the CLI
 * `--version` output (which reads `package.json` directly) and the daemon
 * handshake.
 *
 * Resolution strategy: read the bundled `package.json` two levels up from
 * this file — same relative position whether we're loaded from `src/mcp/` or
 * the `dist/mcp/` output, since `tsc` preserves the layout. If reading fails
 * (e.g. the package was unpacked oddly), fall back to "0.0.0-unknown" — a
 * sentinel that will never match a real version, so the proxy harmlessly
 * falls back to direct mode.
 */

import * as fs from 'fs';
import * as path from 'path';

/** The `package.json` of the install this process runs from. */
export const CodeGraphPackageJsonPath = path.join(__dirname, '..', '..', 'package.json');

function readPackageVersion(): string {
  try {
    const raw = fs.readFileSync(CodeGraphPackageJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.version === 'string' && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // Fall through to sentinel.
  }
  return '0.0.0-unknown';
}

export const CodeGraphPackageVersion = readPackageVersion();

/**
 * Whether `version` is a CodeGraph release older than `than` — the test a
 * launcher applies before it replaces a running daemon (#2335). Only plain
 * `MAJOR.MINOR.PATCH` releases and this distribution's canonical Cangjie
 * release train compare. Other prereleases, build suffixes and the unknown
 * sentinel remain incomparable. Cangjie suffixes are numbered releases, not
 * development builds; rejecting them would leave an old daemon holding the
 * writer lock after every Cangjie upgrade.
 */
export function isOlderRelease(version: string, than: string): boolean {
  const a = parseRelease(version);
  const b = parseRelease(than);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i]! < b.core[i]!;
  }
  // At the same upstream version this distribution extends the plain
  // release. The reverse must never replace it and cause daemon ping-pong.
  if (!a.cangjie || !b.cangjie) return !a.cangjie && !!b.cangjie;
  for (let i = 0; i < 4; i++) {
    if (a.cangjie[i] !== b.cangjie[i]) return a.cangjie[i]! < b.cangjie[i]!;
  }
  return false;
}

interface ReleaseVersion {
  core: number[];
  cangjie?: number[];
}

function parseRelease(version: string): ReleaseVersion | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-cangjie-(\d+)\.(\d+)\.(\d+)\.(\d+))?$/.exec(version);
  if (!m) return null;
  const numbers = m.slice(1).filter((part): part is string => part !== undefined).map(Number);
  if (!numbers.every(Number.isSafeInteger)) return null;
  return { core: numbers.slice(0, 3), ...(numbers.length === 7 ? { cangjie: numbers.slice(3) } : {}) };
}
