/** Runtime configuration, read from environment variables on the host. */
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
  };
}
