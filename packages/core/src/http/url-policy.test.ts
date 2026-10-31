import { describe, expect, it } from 'vitest';

import { BlockedUrlError } from './types.js';
import { assertPublicUrl, normalizeInputUrl } from './url-policy.js';

describe('assertPublicUrl', () => {
  it('allows public hosts on default ports', () => {
    expect(() => {
      assertPublicUrl(new URL('https://example.com/path'));
    }).not.toThrow();
    expect(() => {
      assertPublicUrl(new URL('http://example.com:80/'));
    }).not.toThrow();
    expect(() => {
      assertPublicUrl(new URL('https://93.184.216.34/'));
    }).not.toThrow();
  });

  it.each([
    'http://localhost/',
    'http://127.0.0.1/',
    'http://10.0.0.1/',
    'http://172.16.5.5/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[fd00::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://intranet/',
    'http://files.internal/',
    'https://example.com:8443/',
    'ftp://example.com/',
    'https://user:pw@example.com/',
  ])('blocks %s', (url) => {
    expect(() => {
      assertPublicUrl(new URL(url));
    }).toThrow(BlockedUrlError);
  });
});

describe('normalizeInputUrl', () => {
  it('adds https and strips fragments', () => {
    expect(normalizeInputUrl(' example.com/path#x ').href).toBe('https://example.com/path');
    expect(normalizeInputUrl('http://Example.com').href).toBe('http://example.com/');
  });
});
