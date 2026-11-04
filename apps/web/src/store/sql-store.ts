/**
 * The subset of the D1 binding shape that Spacefast Functions expose as env.DB.
 * Declared locally so the app does not depend on a platform type package.
 */
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first(): Promise<Record<string, unknown> | null>;
  all(): Promise<{ results: Record<string, unknown>[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
}

/**
 * Spacefast's database broker refuses one operation above this many bytes ("Database
 * operation is N bytes; the limit is 65536").
 */
export const MAX_OPERATION_BYTES = 65_536;

/**
 * An upper estimate of what one statement costs against `MAX_OPERATION_BYTES`: the SQL
 * text and its bound values, serialised as JSON and counted in UTF-8 bytes.
 */
export function operationBytes(sql: string, values: readonly unknown[]): number {
  return new TextEncoder().encode(JSON.stringify({ sql, params: values })).byteLength;
}

/** What the three SQL stores share: a database and a table created on first use. */
export abstract class SqlStore {
  private schemaReady: Promise<void> | null = null;

  protected constructor(
    protected readonly db: SqlDatabase,
    private readonly ddl: string,
    /** Idempotent data migrations, run in order after the table exists. */
    private readonly migrations: readonly string[] = [],
  ) {}

  /**
   * Issues the CREATE TABLE IF NOT EXISTS once per store instance, before any other
   * statement, then the migrations. A failed migration is logged, never fatal: the data it
   * would have moved stays readable under its old key.
   */
  protected ensureSchema(): Promise<void> {
    this.schemaReady ??= this.db
      .prepare(this.ddl)
      .run()
      .then(async () => {
        for (const sql of this.migrations) {
          try {
            await this.db.prepare(sql).run();
          } catch (error) {
            console.warn(`[sql] migration failed: ${sql}: ${String(error)}`);
          }
        }
      });
    return this.schemaReady;
  }
}

/** A LIMIT that is always a positive integer, whatever a caller passed. */
export function clampLimit(limit: number, max: number): number {
  if (!Number.isFinite(limit)) return 1;
  return Math.max(1, Math.min(max, Math.trunc(limit)));
}

export class MalformedRowError extends Error {
  constructor(table: string, column: string) {
    super(`malformed ${table} row: ${column}`);
    this.name = 'MalformedRowError';
  }
}

/**
 * Typed column access for a row the broker returned. A row that does not have the shape
 * the DDL promises fails loudly here instead of surfacing as an undefined field later.
 */
export class RowReader {
  constructor(
    private readonly table: string,
    private readonly row: Record<string, unknown>,
  ) {}

  string(column: string): string {
    const value = this.row[column];
    if (typeof value !== 'string') throw new MalformedRowError(this.table, column);
    return value;
  }

  nullableString(column: string): string | null {
    const value = this.row[column];
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') throw new MalformedRowError(this.table, column);
    return value;
  }

  number(column: string): number {
    const value = this.row[column];
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new MalformedRowError(this.table, column);
    return value;
  }

  nullableNumber(column: string): number | null {
    const value = this.row[column];
    if (value === null || value === undefined) return null;
    return this.number(column);
  }
}
