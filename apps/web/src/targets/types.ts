import type { StoredScan } from '../store/types.js';

/**
 * One row per host ever scanned. Scans are purged after the retention window; this
 * registry is not, so the owner can always see which sites were checked, how often and
 * where they stood last.
 */
export interface TargetRecord {
  host: string;
  url: string;
  firstSeenAt: string;
  lastSeenAt: string;
  scanCount: number;
  lastScanId: string;
  lastLevel: number;
  lastIngestion: number;
  lastCommerce: number | null;
  lastPlatform: string;
  lastProfile: string;
}

export interface TargetRegistry {
  record(scan: StoredScan): Promise<void>;
  /** Newest activity first. */
  list(limit: number): Promise<TargetRecord[]>;
}

export function recordFromScan(scan: StoredScan, previous?: TargetRecord): TargetRecord {
  return {
    host: scan.host,
    url: scan.result.target.url,
    firstSeenAt: previous?.firstSeenAt ?? scan.createdAt,
    lastSeenAt: scan.createdAt,
    scanCount: (previous?.scanCount ?? 0) + 1,
    lastScanId: scan.id,
    lastLevel: scan.result.level.value,
    lastIngestion: scan.result.scores.ingestion,
    lastCommerce: scan.result.scores.commerce,
    lastPlatform: scan.result.target.platform,
    lastProfile: scan.result.target.profile,
  };
}
