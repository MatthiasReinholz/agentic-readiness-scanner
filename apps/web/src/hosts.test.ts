import { describe, expect, it } from 'vitest';

import { hostKey, wwwHostMigrations } from './hosts.js';

describe('hostKey', () => {
  it('drops a leading www. and keeps other subdomains', () => {
    expect(hostKey('www.example.com')).toBe('example.com');
    expect(hostKey('WWW.Example.COM.')).toBe('example.com');
    expect(hostKey('example.com')).toBe('example.com');
    expect(hostKey('shop.example.com')).toBe('shop.example.com');
    expect(hostKey('www.shop.example.co.uk')).toBe('shop.example.co.uk');
    expect(hostKey('www2.example.com')).toBe('www2.example.com');
  });

  it('keeps www. when only a top-level domain would remain', () => {
    expect(hostKey('www.com')).toBe('www.com');
    expect(hostKey('www')).toBe('www');
  });
});

describe('wwwHostMigrations', () => {
  it('re-keys plain tables and drops duplicates on keyed ones', () => {
    expect(wwwHostMigrations('scans', false)).toEqual([
      "UPDATE scans SET host = SUBSTRING(host, 5) WHERE host LIKE 'www.%.%'",
    ]);
    expect(wwwHostMigrations('targets', true)).toEqual([
      "UPDATE IGNORE targets SET host = SUBSTRING(host, 5) WHERE host LIKE 'www.%.%'",
      "DELETE FROM targets WHERE host LIKE 'www.%.%'",
    ]);
  });
});
