/**
 * better-sqlite3-shaped synchronous facade over Durable Object SqlStorage.
 *
 * Ledger code and ~280 prepared statements keep their sync semantics;
 * transactions map to `storage.transactionSync`.
 */

export type SqlStorageLike = {
  exec(query: string, ...bindings: unknown[]): SqlCursorLike;
};

export type SqlCursorLike = {
  toArray(): Record<string, unknown>[];
  one(): Record<string, unknown>;
  raw(): IterableIterator<unknown[]> | { toArray(): unknown[][] };
  rowsRead: number;
  rowsWritten: number;
  [Symbol.iterator](): Iterator<Record<string, unknown>>;
};

export type TransactionSync = (fn: () => void) => void;

export type RunResult = {
  changes: number;
  lastInsertRowid: number | bigint;
};

export type StatementLike = {
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
  run(...params: unknown[]): RunResult;
};

export type DatabaseLike = {
  prepare(sql: string): StatementLike;
  exec(sql: string): DatabaseLike;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  transaction<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult;
  close(): void;
};

function normalizeParams(params: unknown[]): unknown[] {
  if (params.length === 1 && Array.isArray(params[0])) {
    return params[0] as unknown[];
  }
  return params;
}

export function createDoDatabase(
  sql: SqlStorageLike,
  transactionSync: TransactionSync,
): DatabaseLike {
  const prepare = (query: string): StatementLike => {
    return {
      get(...params: unknown[]) {
        const bindings = normalizeParams(params);
        const rows = sql.exec(query, ...bindings).toArray();
        return rows[0];
      },
      all(...params: unknown[]) {
        const bindings = normalizeParams(params);
        return sql.exec(query, ...bindings).toArray();
      },
      run(...params: unknown[]) {
        const bindings = normalizeParams(params);
        const cursor = sql.exec(query, ...bindings);
        // Fully consume so rowsWritten is final.
        try {
          cursor.toArray();
        } catch {
          /* DDL / no-result statements */
        }
        let lastInsertRowid: number | bigint = 0;
        try {
          const idRow = sql.exec("SELECT last_insert_rowid() AS id").toArray()[0] as
            { id?: number | bigint } | undefined;
          if (idRow?.id != null) lastInsertRowid = idRow.id;
        } catch {
          /* ignore */
        }
        return {
          changes: Number(cursor.rowsWritten ?? 0),
          lastInsertRowid,
        };
      },
    };
  };

  const database: DatabaseLike = {
    prepare,
    exec(multi: string) {
      sql.exec(multi);
      return database;
    },
    pragma(_source: string, _options?: { simple?: boolean }) {
      // Durable Object SQLite manages journaling; pragmas are no-ops.
      return undefined;
    },
    transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) {
      return (...args: TArgs): TResult => {
        let result!: TResult;
        transactionSync(() => {
          result = fn(...args);
        });
        return result;
      };
    },
    close() {
      /* Durable Object storage is process-owned; nothing to close. */
    },
  };

  return database;
}
