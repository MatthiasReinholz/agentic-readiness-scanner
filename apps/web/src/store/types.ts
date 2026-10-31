import type { ScanResult } from '@agentic-readiness/catalog';

export interface StoredScan {
  id: string;
  host: string;
  createdAt: string;
  result: ScanResult;
}

/**
 * Where scan results live. The hosted app uses the Space's database through the
 * D1-shaped binding; local development and tests use memory. Swapping stores never
 * touches the app.
 */
export interface ResultStore {
  put(scan: StoredScan): Promise<void>;
  get(id: string): Promise<StoredScan | null>;
  latestForHost(host: string): Promise<StoredScan | null>;
  deleteOlderThan(isoTimestamp: string): Promise<number>;
}
