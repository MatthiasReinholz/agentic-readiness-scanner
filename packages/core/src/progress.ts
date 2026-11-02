/**
 * Progress events a scan emits while it runs, so a host can show what the scanner is
 * doing instead of a spinner. Events describe work that happened, never a guess: a
 * phase event is sent after the step finished, a check event after its verdict is set.
 * Hosts that do not listen pay nothing.
 */
import type { Verdict } from '@agentic-readiness/catalog';

export type ScanPhase = 'home' | 'robots' | 'sitemap' | 'sample' | 'checks';

export type ScanProgressEvent =
  | {
      type: 'phase';
      phase: ScanPhase;
      /** One plain line about what the step found. */
      detail: string;
    }
  | {
      type: 'target';
      origin: string;
      platform: string;
      profile: string;
      products: number;
      policies: number;
      /** Checks the runner will decide, in catalog order. */
      checks: number;
    }
  | {
      type: 'check';
      id: string;
      group: string;
      title: string;
      verdict: Verdict;
      skip_reason?: string;
      message?: string;
      /** 1-based position among the decided checks. */
      index: number;
      total: number;
    };

/** What a listener receives: the event plus the scan's running counters. */
export type ScanProgress = ScanProgressEvent & {
  /** Requests spent so far against the budget. */
  requests: number;
  budget: number;
  /** Milliseconds since the scan started. */
  elapsed_ms: number;
};

export type ProgressListener = (event: ScanProgressEvent) => void;

/** Calls a listener and swallows its errors: a broken display must never break a scan. */
export function emitProgress(
  listener: ProgressListener | undefined,
  event: ScanProgressEvent,
): void {
  if (!listener) return;
  try {
    listener(event);
  } catch {
    // The listener is the host's display; the scan carries on without it.
  }
}
