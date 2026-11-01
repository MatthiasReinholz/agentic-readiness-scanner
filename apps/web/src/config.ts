/** Runtime configuration, read from environment variables on the host. */
export type MailProvider = 'brevo' | 'resend' | 'console';

export interface MonitoringConfig {
  /** Null disables monitoring entirely: no signup UI, no routes, no cron work. */
  provider: MailProvider | null;
  apiKey: string | null;
  /** Sender, e.g. "Agentic Readiness Scanner <monitor@example.com>". */
  from: string;
  /** Days between rescans of a monitored host. */
  intervalDays: number;
  /** Subscriptions processed per cron run. */
  batchSize: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** A positive integer from the environment, or the fallback; anything else is a startup error. */
function positiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

export interface AppConfig {
  /** Public base URL of this deployment, used for absolute links in reports and badges. */
  baseUrl: string;
  /** True when APP_BASE_URL was set, false when the base URL was derived from a request. */
  baseUrlExplicit: boolean;
  appName: string;
  /** Requests per scan. */
  scanBudget: number;
  /** Wall-clock budget per scan in milliseconds, below the platform's request limit (30 s on Spacefast Functions). */
  scanDeadlineMs: number;
  /** Seconds a stored result is reused before a target is scanned again. */
  targetCooldownSeconds: number;
  /** Days a stored result is kept. */
  retentionDays: number;
  repositoryUrl: string;
  monitoring: MonitoringConfig;
  /** Bearer token for the owner's export endpoints under /internal/export; null disables them. */
  adminToken: string | null;
}

function mailProvider(env: Record<string, string | undefined>): MailProvider | null {
  if ((env.MAIL_PROVIDER === 'brevo' || env.MAIL_PROVIDER === 'resend') && env.MAIL_API_KEY) {
    return env.MAIL_PROVIDER;
  }
  if (env.MAIL_PROVIDER === 'console') return 'console';
  return null;
}

export function configFromEnv(
  env: Record<string, string | undefined>,
  requestUrl?: string,
): AppConfig {
  const fallbackBase = requestUrl ? new URL(requestUrl).origin : 'http://localhost:8787';
  return {
    baseUrl: (env.APP_BASE_URL ?? fallbackBase).replace(/\/$/, ''),
    baseUrlExplicit: Boolean(env.APP_BASE_URL),
    appName: env.APP_NAME ?? 'Agentic Readiness Scanner',
    scanBudget: positiveInt('SCAN_BUDGET', env.SCAN_BUDGET, 40),
    scanDeadlineMs: positiveInt('SCAN_DEADLINE_MS', env.SCAN_DEADLINE_MS, 24_000),
    targetCooldownSeconds: positiveInt('TARGET_COOLDOWN_SECONDS', env.TARGET_COOLDOWN_SECONDS, 120),
    retentionDays: positiveInt('RETENTION_DAYS', env.RETENTION_DAYS, 30),
    repositoryUrl:
      env.REPOSITORY_URL ?? 'https://github.com/MatthiasReinholz/agentic-readiness-scanner',
    monitoring: {
      provider: mailProvider(env),
      apiKey: env.MAIL_API_KEY ?? null,
      from:
        env.MAIL_FROM ??
        `${env.APP_NAME ?? 'Agentic Readiness Scanner'} <monitor@${new URL(env.APP_BASE_URL ?? fallbackBase).hostname}>`,
      intervalDays: positiveInt('MONITOR_INTERVAL_DAYS', env.MONITOR_INTERVAL_DAYS, 7),
      batchSize: positiveInt('MONITOR_BATCH_SIZE', env.MONITOR_BATCH_SIZE, 10),
    },
    adminToken: env.ADMIN_TOKEN?.trim() ? env.ADMIN_TOKEN.trim() : null,
  };
}
