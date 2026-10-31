/** Runtime configuration, read from environment variables on the host. */
export type MailProvider = 'resend' | 'console';

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

export interface AppConfig {
  /** Public base URL of this deployment, used for absolute links in reports and badges. */
  baseUrl: string;
  appName: string;
  /** Requests per scan. */
  scanBudget: number;
  /** Seconds a stored result is reused before a target is scanned again. */
  targetCooldownSeconds: number;
  /** Days a stored result is kept. */
  retentionDays: number;
  /** Where the WooCommerce companion plugin lives, linked from WooCommerce reports. */
  pluginUrl: string;
  repositoryUrl: string;
  monitoring: MonitoringConfig;
  /** Bearer token for the owner's export endpoints under /internal/export; null disables them. */
  adminToken: string | null;
}

function mailProvider(env: Record<string, string | undefined>): MailProvider | null {
  if (env.MAIL_PROVIDER === 'resend' && env.MAIL_API_KEY) return 'resend';
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
    appName: env.APP_NAME ?? 'Agentic Readiness Scanner',
    scanBudget: Number(env.SCAN_BUDGET ?? 40),
    targetCooldownSeconds: Number(env.TARGET_COOLDOWN_SECONDS ?? 120),
    retentionDays: Number(env.RETENTION_DAYS ?? 30),
    pluginUrl:
      env.PLUGIN_URL ??
      'https://github.com/MatthiasReinholz/agentic-readiness-scanner#companion-plugin',
    repositoryUrl:
      env.REPOSITORY_URL ?? 'https://github.com/MatthiasReinholz/agentic-readiness-scanner',
    monitoring: {
      provider: mailProvider(env),
      apiKey: env.MAIL_API_KEY ?? null,
      from:
        env.MAIL_FROM ??
        `${env.APP_NAME ?? 'Agentic Readiness Scanner'} <monitor@${new URL(env.APP_BASE_URL ?? fallbackBase).hostname}>`,
      intervalDays: Number(env.MONITOR_INTERVAL_DAYS ?? 7),
      batchSize: Number(env.MONITOR_BATCH_SIZE ?? 10),
    },
    adminToken: env.ADMIN_TOKEN?.trim() ? env.ADMIN_TOKEN.trim() : null,
  };
}
