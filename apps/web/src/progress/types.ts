/**
 * Progress of a scan in flight, kept where any request can read it. The platform buffers
 * streamed responses until they end, so the page cannot rely on the event stream to see
 * a scan happen; the scan request writes its events here as it goes and the page polls.
 */
export interface ProgressFinal {
  event: 'done' | 'failure';
  data: unknown;
}

export interface ProgressRecord {
  /** Events in order, each carrying its `seq`. */
  events: unknown[];
  /** Set once the scan ended: the same payload the stream's last event carries. */
  final: ProgressFinal | null;
  updatedAt: string;
}

export interface ProgressStore {
  /** Replaces the record for a token (the whole event list so far, and the final event if any). */
  save(token: string, record: ProgressRecord): Promise<void>;
  load(token: string): Promise<ProgressRecord | null>;
  /** Removes records last written before the timestamp; progress is only useful for minutes. */
  deleteOlderThan(isoTimestamp: string): Promise<number>;
}

/** Tokens are 32 lower-case hex characters the page generates per scan. */
export const PROGRESS_TOKEN = /^[0-9a-f]{32}$/;
