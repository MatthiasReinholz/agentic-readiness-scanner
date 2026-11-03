import type { ScanProgress } from '@agentic-readiness/core';

import type { ProgressFinal, ProgressStore } from '../progress/types.js';

/** A progress event as the page receives it: the scanner's event and its place in the sequence. */
export type RecordedProgress = ScanProgress & { seq: number };

/** What identifies an event across steps: every step replays the phases and decided checks. */
function eventKey(event: { type?: unknown; id?: unknown; phase?: unknown }): string {
  if (event.type === 'check') return `check:${String(event.id)}`;
  if (event.type === 'phase') return `phase:${String(event.phase)}`;
  return String(event.type);
}

/**
 * Writes a scan's progress to the page's record across steps, whichever request runs
 * them. Each step resolves the target and replays earlier outcomes, so only events the
 * record does not hold yet are kept, numbered on from the last one. Writes are throttled;
 * `flush` and `finish` write what is pending. Without a store or token it still numbers
 * and filters, for the event stream.
 */
export class ProgressRecorder {
  private lastSaved = 0;
  private saving: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly store: ProgressStore | undefined,
    private readonly token: string | null,
    private readonly events: unknown[],
    private readonly seen: Set<string>,
    private seq: number,
    private final: ProgressFinal | null,
  ) {}

  static async open(
    store: ProgressStore | undefined,
    token: string | null,
  ): Promise<ProgressRecorder> {
    const record = store && token ? await store.load(token).catch(() => null) : null;
    const events = record?.events ?? [];
    const seen = new Set<string>();
    let seq = 0;
    for (const event of events) {
      if (typeof event !== 'object' || event === null) continue;
      seen.add(eventKey(event));
      seq = Math.max(seq, Number((event as { seq?: unknown }).seq) || 0);
    }
    return new ProgressRecorder(store, token, [...events], seen, seq, record?.final ?? null);
  }

  /** The event with its sequence number when it is new to the page; null when it is a replay. */
  emit(progress: ScanProgress): RecordedProgress | null {
    const key = eventKey(progress);
    if (this.seen.has(key)) return null;
    this.seen.add(key);
    this.seq += 1;
    const event = { ...progress, seq: this.seq };
    this.events.push(event);
    if (Date.now() - this.lastSaved > 400) void this.save();
    return event;
  }

  /** Writes what is pending, for a step that paused. */
  flush(): Promise<unknown> {
    return this.save();
  }

  /** Writes the final event, unless the record already has one. */
  async finish(event: ProgressFinal['event'], data: unknown): Promise<void> {
    if (this.final) return;
    this.final = { event, data };
    await this.save();
  }

  private save(): Promise<unknown> {
    if (!this.store || !this.token) return Promise.resolve();
    const { store, token } = this;
    const record = {
      events: [...this.events],
      final: this.final,
      updatedAt: new Date().toISOString(),
    };
    this.lastSaved = Date.now();
    this.saving = this.saving.then(() =>
      store.save(token, record).catch((error: unknown) => {
        console.error('[scan-progress]', error);
      }),
    );
    return this.saving;
  }
}
