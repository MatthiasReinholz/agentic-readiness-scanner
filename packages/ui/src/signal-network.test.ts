import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { SIGNAL_NETWORK_SCRIPT } from './signal-network.js';

describe('background motion control', () => {
  it('restores the saved pause, resumes on request, and respects live OS motion changes', () => {
    let stored = 'paused';
    let click: () => void = () => {
      throw new Error('Click handler not installed');
    };
    let change: () => void = () => {
      throw new Error('Media handler not installed');
    };
    const root = new Map<string, string>();
    const attributes = new Map<string, string>();
    const media = {
      matches: false,
      addEventListener: (_: string, cb: () => void) => {
        change = cb;
      },
    };
    const button = {
      hidden: true,
      disabled: false,
      textContent: '',
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      addEventListener: (_: string, cb: () => void) => {
        click = cb;
      },
    };
    runInNewContext(SIGNAL_NETWORK_SCRIPT, {
      window: { matchMedia: () => media },
      localStorage: {
        getItem: () => stored,
        setItem: (_: string, value: string) => {
          stored = value;
        },
      },
      document: {
        documentElement: { setAttribute: (name: string, value: string) => root.set(name, value) },
        querySelectorAll: () => [button],
      },
    });
    expect(root.get('data-motion')).toBe('paused');
    expect(button.hidden).toBe(false);
    expect(attributes.get('aria-pressed')).toBe('true');
    click();
    expect(root.get('data-motion')).toBe('running');
    expect(stored).toBe('running');
    media.matches = true;
    change();
    expect(root.get('data-motion')).toBe('paused');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Reduced motion');
  });
});
