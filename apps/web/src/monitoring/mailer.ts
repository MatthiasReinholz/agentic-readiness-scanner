import type { MonitoringConfig } from '../config.js';
import type { Mailer, MailMessage } from './types.js';

export class MailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailError';
  }
}

export interface Sender {
  email: string;
  name?: string;
}

/** Parses "Name <address>" or a bare address into its parts. */
export function parseSender(from: string): Sender {
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(from);
  if (match?.[2]) {
    const name = match[1]?.trim();
    return name ? { email: match[2].trim(), name } : { email: match[2].trim() };
  }
  return { email: from.trim() };
}

export interface BrevoMailerOptions {
  apiKey: string;
  from: string;
  fetch?: typeof fetch;
  endpoint?: string;
}

/**
 * Sends through Brevo's transactional email API (api.brevo.com/v3/smtp/email).
 * Authentication is the `api-key` header; success is 201 with a messageId.
 */
export class BrevoMailer implements Mailer {
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly sender: Sender;

  constructor(private readonly options: BrevoMailerOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.endpoint = options.endpoint ?? 'https://api.brevo.com/v3/smtp/email';
    this.sender = parseSender(options.from);
  }

  async send(message: MailMessage): Promise<void> {
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        'api-key': this.options.apiKey,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: this.sender,
        to: [{ email: message.to }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }),
    });
    if (!response.ok) {
      throw new MailError(`Mail provider responded ${response.status}: ${await response.text()}`);
    }
  }
}

export interface ResendMailerOptions {
  apiKey: string;
  from: string;
  fetch?: typeof fetch;
  endpoint?: string;
}

/** Sends through Resend's HTTP API. Swapping providers means one more class like this. */
export class ResendMailer implements Mailer {
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;

  constructor(private readonly options: ResendMailerOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.endpoint = options.endpoint ?? 'https://api.resend.com/emails';
  }

  async send(message: MailMessage): Promise<void> {
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.options.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    if (!response.ok) {
      throw new MailError(`Mail provider responded ${response.status}: ${await response.text()}`);
    }
  }
}

/** Prints mail to the console. For local development only. */
export class ConsoleMailer implements Mailer {
  send(message: MailMessage): Promise<void> {
    console.log(`[mail] to=${message.to} subject=${message.subject}\n${message.text}`);
    return Promise.resolve();
  }
}

/** Collects mail in memory for tests. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

export function createMailer(config: MonitoringConfig, fetchImpl?: typeof fetch): Mailer | null {
  switch (config.provider) {
    case 'brevo':
      return new BrevoMailer({
        apiKey: config.apiKey ?? '',
        from: config.from,
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      });
    case 'resend':
      return new ResendMailer({
        apiKey: config.apiKey ?? '',
        from: config.from,
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      });
    case 'console':
      return new ConsoleMailer();
    case null:
      return null;
  }
}
