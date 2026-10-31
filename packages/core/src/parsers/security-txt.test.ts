import { describe, expect, it } from 'vitest';

import { parseSecurityTxt } from './security-txt.js';

describe('parseSecurityTxt', () => {
  it('collects repeated Contact fields and parses Expires', () => {
    const parsed = parseSecurityTxt(
      '# Our policy\r\nContact: mailto:security@shop.example\r\nContact: https://shop.example/security\r\nExpires: 2030-01-01T00:00:00.000Z\r\nPreferred-Languages: en, de\r\n',
    );
    expect(parsed.contacts).toEqual([
      'mailto:security@shop.example',
      'https://shop.example/security',
    ]);
    expect(parsed.expires?.toISOString()).toBe('2030-01-01T00:00:00.000Z');
    expect(parsed.fields['preferred-languages']).toEqual(['en, de']);
  });

  it('lower-cases field names and keeps the value after the first colon', () => {
    const parsed = parseSecurityTxt('CONTACT:   https://shop.example/a:b\n');
    expect(parsed.contacts).toEqual(['https://shop.example/a:b']);
  });

  it('skips comments, blank lines and lines without a separator', () => {
    const parsed = parseSecurityTxt('\n# comment\nnot a field\nContact: mailto:a@b.co\n');
    expect(parsed.contacts).toEqual(['mailto:a@b.co']);
    expect(Object.keys(parsed.fields)).toEqual(['contact']);
  });

  it('reports an unparsable or missing Expires as null', () => {
    expect(parseSecurityTxt('Contact: mailto:a@b.co\nExpires: soon\n').expires).toBeNull();
    expect(parseSecurityTxt('Contact: mailto:a@b.co\n').expires).toBeNull();
    expect(parseSecurityTxt('').contacts).toEqual([]);
  });
});
