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
  /** Requests per scan, across all its steps. */
  scanBudget: number;
  /**
   * Wall-clock allowance of one scan step in milliseconds. A step runs inside one request,
   * and Spacefast Functions answer within 30 s, so it leaves room to store the state.
   */
  scanStepMs: number;
  /** Steps after which a scan finishes with the checks it could not reach marked not run. */
  scanMaxSteps: number;
  /** Active scanning time across steps after which a scan finishes the same way. */
  scanMaxActiveMs: number;
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
    scanBudget: positiveInt('SCAN_BUDGET', env.SCAN_BUDGET, 60),
    // SCAN_DEADLINE_MS was the whole scan's budget before scans ran in steps; it is read
    // as the step allowance so an existing setting keeps a step inside the request limit.
    scanStepMs: positiveInt('SCAN_STEP_MS', env.SCAN_STEP_MS ?? env.SCAN_DEADLINE_MS, 20_000),
    scanMaxSteps: positiveInt('SCAN_MAX_STEPS', env.SCAN_MAX_STEPS, 12),
    scanMaxActiveMs: positiveInt('SCAN_MAX_ACTIVE_MS', env.SCAN_MAX_ACTIVE_MS, 180_000),
    targetCooldownSeconds: Math.max(
      60,
      positiveInt('TARGET_COOLDOWN_SECONDS', env.TARGET_COOLDOWN_SECONDS, 60),
    ),
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
