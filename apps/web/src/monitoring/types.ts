import type { ResultSnapshot } from '@agentic-readiness/core';

export type MonitorStatus = 'pending' | 'active' | 'unsubscribed';

/** A snapshot of the last scan a subscriber was told about, plus when it was taken. */
export interface Baseline extends ResultSnapshot {
  scannedAt: string;
  scanId: string;
}

/**
 * One subscription: an email address watching one host. Tokens are stored hashed; the
 * raw token travels only in the confirmation and unsubscribe links.
 */
export interface Monitor {
  id: string;
  email: string;
  host: string;
  /** Canonical URL that is rescanned. */
  url: string;
  status: MonitorStatus;
  confirmTokenHash: string;
  manageTokenHash: string;
  createdAt: string;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  lastCheckedAt: string | null;
  lastNotifiedAt: string | null;
  baseline: Baseline | null;
}

export interface MonitorStore {
  create(monitor: Monitor): Promise<void>;
  update(monitor: Monitor): Promise<void>;
  get(id: string): Promise<Monitor | null>;
  findByEmailAndHost(email: string, host: string): Promise<Monitor | null>;
  /** Active monitors never checked or last checked before `before`, oldest first. */
  listDue(before: string, limit: number): Promise<Monitor[]>;
  /** Everything, newest first, for the owner's export. */
  list(limit: number): Promise<Monitor[]>;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
