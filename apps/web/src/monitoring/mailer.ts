import type { MonitoringConfig } from '../config.js';
import type { Mailer, MailMessage } from './types.js';

export class MailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailError';
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
