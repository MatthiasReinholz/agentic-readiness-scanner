import { describe, expect, it } from 'vitest';

import {
  parseTdmrepJson,
  validateAbsoluteUrl,
  validateContentSignal,
  validateContentUsage,
  validateLicenseUrl,
  validateTdmReservation,
} from './usage-preferences.js';

describe('validateContentSignal', () => {
  it('accepts the documented vocabulary, any case, with or without a leading path', () => {
    expect(validateContentSignal('ai-train=no, search=yes, ai-input=yes')).toEqual({
      valid: true,
    });
    expect(validateContentSignal('/images/ AI-Train=No')).toEqual({ valid: true });
  });

  it('names the problem for unknown signals, missing values and empty expressions', () => {
    expect(validateContentSignal('train-ai=n').problem).toMatch(/unknown signal "train-ai"/);
    expect(validateContentSignal('ai-train').problem).toMatch(/yes or no/);
    expect(validateContentSignal('ai-train=maybe').problem).toMatch(/yes or no/);
    expect(validateContentSignal('search=yes,,ai-input=no').problem).toMatch(/empty item/);
    expect(validateContentSignal('/images/').problem).toMatch(/no signal values/);
  });
});

describe('validateContentUsage', () => {
  it('accepts an RFC 9651 dictionary of the aipref vocabulary, with parameters ignored', () => {
    expect(validateContentUsage('train-ai=n, ai-use=y, search=y')).toEqual({ valid: true });
    expect(validateContentUsage('train-ai=n;note=x')).toEqual({ valid: true });
    expect(validateContentUsage('/images/ train-ai=y', { allowPath: true })).toEqual({
      valid: true,
    });
  });

  it('rejects Content-Signal tokens, bad keys, bad values, and a path where none is allowed', () => {
    expect(validateContentUsage('ai-train=no').problem).toMatch(/unknown key "ai-train"/);
    expect(validateContentUsage('Train-AI=n').problem).toMatch(/not a structured-field/);
    expect(validateContentUsage('train-ai=no').problem).toMatch(/y or n/);
    expect(validateContentUsage('train-ai').problem).toMatch(/y or n/);
    expect(validateContentUsage('/images/ train-ai=n').problem).toMatch(/dictionary key/);
    expect(validateContentUsage('/images/', { allowPath: true }).problem).toMatch(/no preferences/);
    expect(validateContentUsage('').problem).toBe('empty value');
  });
});

describe('URL and TDM validators', () => {
  it('requires an absolute https URL for an RSL license and an absolute URL for a policy', () => {
    expect(validateLicenseUrl('https://shop.example/license.xml')).toEqual({ valid: true });
    expect(validateLicenseUrl('http://shop.example/license.xml').problem).toMatch(/https/);
    expect(validateLicenseUrl('/license.xml').problem).toMatch(/absolute/);
    expect(validateAbsoluteUrl('http://shop.example/policy')).toEqual({ valid: true });
    expect(validateAbsoluteUrl('mailto:x@shop.example').problem).toMatch(/http/);
  });

  it('accepts only 0 or 1 as a TDM reservation', () => {
    expect(validateTdmReservation(' 1 ')).toEqual({ valid: true });
    expect(validateTdmReservation('0')).toEqual({ valid: true });
    expect(validateTdmReservation('yes').problem).toBe('must be 0 or 1');
  });
});

describe('parseTdmrepJson', () => {
  it('accepts an array of location and reservation entries', () => {
    const parsed = parseTdmrepJson(
      JSON.stringify([
        { location: '/', 'tdm-reservation': 1, 'tdm-policy': 'https://shop.example/tdm' },
        { location: '/public/*', 'tdm-reservation': 0 },
      ]),
    );
    expect(parsed).toEqual({ kind: 'valid', entries: 2 });
  });

  it('treats an HTML answer as a soft 404 and names what is wrong otherwise', () => {
    expect(parseTdmrepJson('<!doctype html><html></html>').kind).toBe('html');
    expect(parseTdmrepJson('not json')).toMatchObject({ kind: 'invalid', problem: 'not JSON' });
    expect(parseTdmrepJson('{"location":"/"}').problem).toBe('must be a JSON array');
    expect(parseTdmrepJson('[{"tdm-reservation":"1"}]').problem).toMatch(
      /entry 0 lacks a location; entry 0 needs tdm-reservation 0 or 1/,
    );
    expect(
      parseTdmrepJson('[{"location":"/","tdm-reservation":1,"tdm-policy":"/p"}]').problem,
    ).toMatch(/tdm-policy/);
    expect(parseTdmrepJson('[1]').problem).toBe('entry 0 is not an object');
  });
});
