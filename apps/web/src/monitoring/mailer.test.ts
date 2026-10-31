import { describe, expect, it } from 'vitest';

import { configFromEnv } from '../config.js';
import { BrevoMailer, createMailer, MailError, parseSender, ResendMailer } from './mailer.js';

interface Captured {
  url: string;
  init: RequestInit;
}

function fakeFetch(status: number, body = '{}'): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

const message = {
  to: 'owner@example.com',
  subject: 'Confirm monitoring for shop.example',
  text: 'plain',
  html: '<p>html</p>',
};

describe('parseSender', () => {
  it('splits a display name from the address and accepts a bare address', () => {
    expect(parseSender('Agentic Readiness Scanner <monitor@example.com>')).toEqual({
      email: 'monitor@example.com',
      name: 'Agentic Readiness Scanner',
    });
    expect(parseSender('"Quoted Name" <a@b.co>')).toEqual({ email: 'a@b.co', name: 'Quoted Name' });
    expect(parseSender('monitor@example.com')).toEqual({ email: 'monitor@example.com' });
  });
});

describe('BrevoMailer', () => {
  it('posts the transactional email shape with the api-key header', async () => {
    const { fetch, calls } = fakeFetch(201, '{"messageId":"<1@relay>"}');
    const mailer = new BrevoMailer({
      apiKey: 'xkeysib-test',
      from: 'Scanner <monitor@example.com>',
      fetch,
    });
    await mailer.send(message);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.brevo.com/v3/smtp/email');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['api-key']).toBe('xkeysib-test');
    expect(headers['content-type']).toBe('application/json');
    const body = calls[0]?.init.body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string)).toEqual({
      sender: { email: 'monitor@example.com', name: 'Scanner' },
      to: [{ email: 'owner@example.com' }],
      subject: 'Confirm monitoring for shop.example',
      htmlContent: '<p>html</p>',
      textContent: 'plain',
    });
  });

  it('surfaces provider errors with status and body', async () => {
    const { fetch } = fakeFetch(401, '{"code":"unauthorized","message":"Key not found"}');
    const mailer = new BrevoMailer({ apiKey: 'bad', from: 'monitor@example.com', fetch });
    await expect(mailer.send(message)).rejects.toThrow(MailError);
    await expect(mailer.send(message)).rejects.toThrow(/401.*Key not found/);
  });
});

describe('ResendMailer', () => {
  it('posts with a bearer token', async () => {
    const { fetch, calls } = fakeFetch(200);
    await new ResendMailer({ apiKey: 're_test', from: 'monitor@example.com', fetch }).send(message);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer re_test');
    expect(calls[0]?.url).toBe('https://api.resend.com/emails');
  });
});

describe('createMailer', () => {
  it('picks the adapter from MAIL_PROVIDER and refuses a provider without a key', () => {
    const brevo = configFromEnv({ MAIL_PROVIDER: 'brevo', MAIL_API_KEY: 'k' }).monitoring;
    expect(createMailer(brevo)).toBeInstanceOf(BrevoMailer);
    const resend = configFromEnv({ MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'k' }).monitoring;
    expect(createMailer(resend)).toBeInstanceOf(ResendMailer);
    expect(configFromEnv({ MAIL_PROVIDER: 'brevo' }).monitoring.provider).toBeNull();
    expect(createMailer(configFromEnv({}).monitoring)).toBeNull();
  });
});
