/**
 * Test double for the D1-shaped binding. It executes no SQL: it records every prepared
 * statement with its bound values and answers from scripted rows per SQL pattern, so a
 * test can assert what a store asked the database and what it did with the answer.
 */
import type { SqlDatabase, SqlStatement } from './sql-store.js';

export interface ExecutedStatement {
  sql: string;
  values: unknown[];
}

interface Script {
  pattern: RegExp;
  rows: Record<string, unknown>[];
  changes: number;
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

  /**
   * Statements whose SQL matches answer with these rows (first() gives the first one) and
   * report `changes` from run(). The latest matching script wins; unscripted statements
   * answer with no rows and zero changes.
   */
  script(
    pattern: RegExp | string,
    rows: Record<string, unknown>[] = [],
    changes = rows.length,
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

  /** Records the execution and finds the script that answers it. Called by the statement. */
  execute(sql: string, values: unknown[]): Script | undefined {
    this.executed.push({ sql, values });
    return [...this.scripts].reverse().find((script) => script.pattern.test(sql));
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
    return Promise.resolve(this.db.execute(this.sql, this.values)?.rows[0] ?? null);
  }

  all(): Promise<{ results: Record<string, unknown>[] }> {
    return Promise.resolve({ results: this.db.execute(this.sql, this.values)?.rows ?? [] });
  }

  run(): Promise<{ meta?: { changes?: number } }> {
    const script = this.db.execute(this.sql, this.values);
    return Promise.resolve(script ? { meta: { changes: script.changes } } : {});
  }
}
