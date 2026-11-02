import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { SIGNAL_NETWORK_SCRIPT } from './signal-network.js';

describe('background motion preferences', () => {
  it('animates by default and responds to live OS reduced-motion changes without storage or controls', () => {
    let change: () => void = () => {
      throw new Error('Media handler not installed');
    };
    const root = new Map<string, string>();
    const media = {
      matches: false,
      addEventListener: (_: string, cb: () => void) => {
        change = cb;
      },
    };
    runInNewContext(SIGNAL_NETWORK_SCRIPT, {
      window: { matchMedia: () => media },
      document: {
        documentElement: { setAttribute: (name: string, value: string) => root.set(name, value) },
      },
    });
    expect(root.get('data-motion')).toBe('running');
    media.matches = true;
    change();
    expect(root.get('data-motion')).toBe('paused');
    media.matches = false;
    change();
    expect(root.get('data-motion')).toBe('running');
  });
});
