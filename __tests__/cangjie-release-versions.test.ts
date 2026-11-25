import { describe, expect, it } from 'vitest';
import { isOlderRelease } from '../src/mcp/version';

const CURRENT = '1.6.4-cangjie-1.0.6.1';

describe('Cangjie daemon upgrade release ordering', () => {
  it.each([
    ['0.0.1', CURRENT],
    ['1.6.3', CURRENT],
    ['1.6.4', CURRENT],
    ['1.5.0-cangjie-1.0.5.3', CURRENT],
    ['1.6.4-cangjie-1.0.5.10', CURRENT],
    [CURRENT, '1.6.4-cangjie-1.0.6.2'],
    ['1.6.4-cangjie-1.0.6.2', '1.6.4-cangjie-1.0.6.10'],
    [CURRENT, '1.6.5-cangjie-1.0.6.1'],
  ])('replaces an older %s daemon with %s', (older, newer) => {
    expect(isOlderRelease(older, newer)).toBe(true);
    expect(isOlderRelease(newer, older)).toBe(false);
  });

  it.each([
    '0.0.0-unknown', '1.6.4-beta.1', '1.6.4+local', 'v1.6.4',
    '1.6.4-cangjie-1.0.6', '1.6.4-cangjie-1.0.6.1-dev',
    '1.6.4-cangjie-1.0.6.1+local', '99999999999999999999.0.0',
  ])('never authorizes replacement using an unknown version: %s', odd => {
    expect(isOlderRelease(odd, CURRENT)).toBe(false);
    expect(isOlderRelease(CURRENT, odd)).toBe(false);
  });

  it('never replaces an equal version or permits mutual replacement', () => {
    const versions = ['1.5.0', '1.6.4', '1.5.0-cangjie-1.0.5.3', CURRENT, '1.6.4-cangjie-1.0.6.10', '1.6.5', '0.0.0-unknown'];
    for (const a of versions) {
      expect(isOlderRelease(a, a)).toBe(false);
      for (const b of versions) expect(isOlderRelease(a, b) && isOlderRelease(b, a), `${a} / ${b}`).toBe(false);
    }
  });
});
