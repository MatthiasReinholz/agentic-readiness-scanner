/**
 * Test double for the D1-shaped binding. It executes no SQL: it records every prepared
 * statement with its bound values and answers from scripted rows per SQL pattern, so a
 * test can assert what a store asked the database and what it did with the answer.
 */
import { operationBytes, type SqlDatabase, type SqlStatement } from './sql-store.js';

export interface ExecutedStatement {
  sql: string;
  values: unknown[];
  /** The statement's size as `operationBytes` counts it. */
  bytes: number;
}

type Rows = Record<string, unknown>[];

interface Script {
  pattern: RegExp;
  rows: Rows | ((values: unknown[]) => Rows);
  changes: number;
}

export interface FakeSqlOptions {
  /**
   * Refuse statements above this many bytes the way Spacefast's broker does. The statement
   * is still recorded, so a test can see it was attempted.
   */
  maxOperationBytes?: number;
}

function toPattern(pattern: RegExp | string): RegExp {
  return typeof pattern === 'string'
    ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    : pattern;
}

export class FakeSqlDatabase implements SqlDatabase {
  /** Every statement whose first(), all() or run() was awaited, in order. */
  readonly executed: ExecutedStatement[] = [];
  private readonly scripts: Script[] = [];

  constructor(private readonly options: FakeSqlOptions = {}) {}

  /**
   * Statements whose SQL matches answer with these rows (first() gives the first one) and
   * report `changes` from run(). Rows may be a function of the bound values, which lets a
   * test keep a small table. The latest matching script wins; unscripted statements answer
   * with no rows and zero changes.
   */
  script(
    pattern: RegExp | string,
    rows: Rows | ((values: unknown[]) => Rows) = [],
    changes = Array.isArray(rows) ? rows.length : 0,
  ): this {
    this.scripts.push({ pattern: toPattern(pattern), rows, changes });
    return this;
  }

  prepare(sql: string): SqlStatement {
    return new FakeStatement(this, sql, []);
  }

  /** Executed statements whose SQL matches. */
  statements(pattern: RegExp | string): ExecutedStatement[] {
    const regex = toPattern(pattern);
    return this.executed.filter((statement) => regex.test(statement.sql));
  }

  /** Records the execution and answers it from the matching script. Called by the statement. */
  execute(sql: string, values: unknown[]): { rows: Rows; changes: number } | undefined {
    const bytes = operationBytes(sql, values);
    this.executed.push({ sql, values, bytes });
    const limit = this.options.maxOperationBytes;
    if (limit !== undefined && bytes > limit) {
      throw new Error(
        `Database operation is ${bytes} bytes; the limit is ${limit}. Send fewer or smaller statements per call.`,
      );
    }
    const script = [...this.scripts].reverse().find((candidate) => candidate.pattern.test(sql));
    if (!script) return undefined;
    const rows = typeof script.rows === 'function' ? script.rows(values) : script.rows;
    return { rows, changes: script.changes };
  }
}

class FakeStatement implements SqlStatement {
  constructor(
    private readonly db: FakeSqlDatabase,
    private readonly sql: string,
    private readonly values: unknown[],
  ) {}

  bind(...values: unknown[]): SqlStatement {
    return new FakeStatement(this.db, this.sql, values);
  }

  first(): Promise<Record<string, unknown> | null> {
    return Promise.resolve().then(() => this.db.execute(this.sql, this.values)?.rows[0] ?? null);
  }

  all(): Promise<{ results: Record<string, unknown>[] }> {
    return Promise.resolve().then(() => ({
      results: this.db.execute(this.sql, this.values)?.rows ?? [],
    }));
  }

  run(): Promise<{ meta?: { changes?: number } }> {
    return Promise.resolve().then(() => {
      const answer = this.db.execute(this.sql, this.values);
      return answer ? { meta: { changes: answer.changes } } : {};
    });
  }
}
