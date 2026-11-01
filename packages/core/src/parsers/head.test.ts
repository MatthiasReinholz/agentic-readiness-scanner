import { describe, expect, it } from 'vitest';

import { scanHead } from './head.js';

describe('scanHead', () => {
  it('accepts a well-formed head', () => {
    const scan = scanHead(
      '<!doctype html><html><head><meta charset="utf-8"><title>Mug</title><link rel="canonical" href="https://s.example/mug/"><meta name="robots" content="index"><script src="/a.js"></script><noscript><img src="/px.gif"></noscript></head><body><div>x</div></body></html>',
    );
    expect(scan.doctype).toBe('html');
    expect(scan.charsetOffset).toBe(27);
    expect(scan.invalidHeadElement).toBeNull();
    expect(scan.misplaced).toEqual([]);
    expect(scan.metaRefreshSeconds).toBeNull();
  });

  it('records metadata after an element that does not belong in the head, and in the body', () => {
    const html =
      '<html><head><meta charset="utf-8"><iframe src="/tag"></iframe><title>Mug</title><link rel="canonical" href="/mug/"></head><body><meta name="description" content="late"><link rel="alternate" hreflang="de" href="/de/"></body></html>';
    const scan = scanHead(html);
    expect(scan.doctype).toBe('none');
    expect(scan.invalidHeadElement).toEqual({ tag: 'iframe', offset: html.indexOf('<iframe') });
    expect(scan.misplaced.map((m) => `${m.kind}:${m.where}`)).toEqual([
      'title:after_invalid',
      'canonical:after_invalid',
      'description:body',
      'hreflang:body',
    ]);
  });

  it('treats a document without an explicit head as starting in the head', () => {
    const scan = scanHead('<title>Mug</title><div>content</div><title>Second</title>');
    expect(scan.invalidHeadElement?.tag).toBe('div');
    expect(scan.misplaced).toEqual([{ kind: 'title', offset: 36, where: 'after_invalid' }]);
  });

  it('reads doctypes, legacy charset declarations and meta refresh', () => {
    const scan = scanHead(
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0//EN"><html><head><meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1"><meta http-equiv="refresh" content="0; url=https://s.example/new/"></head></html>',
    );
    expect(scan.doctype).toBe('other');
    expect(scan.charsetOffset).toBeGreaterThan(0);
    expect(scan.metaRefreshSeconds).toBe(0);
    expect(scan.metaRefreshUrl).toBe('https://s.example/new/');
    expect(scanHead('<meta http-equiv="refresh" content="30">').metaRefreshSeconds).toBeNull();
    expect(scanHead('<meta http-equiv=refresh content="5;URL=\'/x\'">').metaRefreshUrl).toBe('/x');
  });

  it('ignores the title and metadata inside inline SVG and MathML, but not around them', () => {
    const icons =
      '<!doctype html><html><head><meta charset="utf-8"><title>Mug</title></head><body><a href="/"><svg viewBox="0 0 10 10"><title>Home</title><desc>Icon</desc><g><svg><title>Nested</title></svg><path d="M0 0"/></g></svg></a><math><mi>x</mi><title>Formula</title></math><p>x</p></body></html>';
    expect(scanHead(icons).misplaced).toEqual([]);
    expect(scanHead(icons).invalidHeadElement).toBeNull();
    const misplaced =
      '<!doctype html><html><head><meta charset="utf-8"></head><body><svg><title>Icon</title></svg><title>Mug</title></body></html>';
    expect(scanHead(misplaced).misplaced).toEqual([
      { kind: 'title', offset: misplaced.indexOf('<title>Mug'), where: 'body' },
    ]);
    // An <svg> inside the head is not a head element: it ends the head like any other.
    const inHead = '<html><head><svg><title>Icon</title></svg><title>Mug</title></head></html>';
    expect(scanHead(inHead).invalidHeadElement).toEqual({ tag: 'svg', offset: 12 });
    expect(scanHead(inHead).misplaced).toEqual([
      { kind: 'title', offset: inHead.indexOf('<title>Mug'), where: 'after_invalid' },
    ]);
  });
});
