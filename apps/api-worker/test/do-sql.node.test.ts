import { describe, expect, it } from "vitest";
import { createDoDatabase } from "../src/storage/do-sql.js";

describe("createDoDatabase adapter", () => {
  it("supports prepare/get/all/run/transaction/exec", () => {
    const rows = new Map();
    const sql = {
      exec(query: string, ...bindings: unknown[]) {
        const q = query.trim();
        if (q.startsWith("CREATE") || q.startsWith("INSERT") || q.startsWith("UPDATE")) {
          if (q.includes("INSERT INTO t")) {
            rows.set(bindings[0], bindings[1]);
          }
          return {
            toArray: () => [],
            one: () => ({}),
            raw: () => ({ toArray: () => [] }),
            rowsRead: 0,
            rowsWritten: q.includes("INSERT") ? 1 : 0,
            [Symbol.iterator]: function* () {},
          };
        }
        if (q.includes("last_insert_rowid")) {
          return {
            toArray: () => [{ id: 1 }],
            one: () => ({ id: 1 }),
            raw: () => ({ toArray: () => [[1]] }),
            rowsRead: 1,
            rowsWritten: 0,
            [Symbol.iterator]: function* () {
              yield { id: 1 };
            },
          };
        }
        if (q.includes("SELECT")) {
          const id = bindings[0];
          const value = rows.get(id);
          const out = value == null ? [] : [{ id, value }];
          return {
            toArray: () => out,
            one: () => out[0],
            raw: () => ({ toArray: () => out.map((r) => [r.id, r.value]) }),
            rowsRead: out.length,
            rowsWritten: 0,
            [Symbol.iterator]: function* () {
              yield* out;
            },
          };
        }
        return {
          toArray: () => [],
          one: () => ({}),
          raw: () => ({ toArray: () => [] }),
          rowsRead: 0,
          rowsWritten: 0,
          [Symbol.iterator]: function* () {},
        };
      },
    };

    let inTx = false;
    const db = createDoDatabase(sql, (fn) => {
      inTx = true;
      fn();
      inTx = false;
    });

    db.exec("CREATE TABLE t (id TEXT, value TEXT)");
    const tx = db.transaction((id: string, value: string) => {
      expect(inTx).toBe(true);
      db.prepare("INSERT INTO t VALUES (?, ?)").run(id, value);
    });
    tx("a", "1");
    expect(db.prepare("SELECT * FROM t WHERE id = ?").get("a")).toEqual({ id: "a", value: "1" });
    expect(db.prepare("SELECT * FROM t WHERE id = ?").all("a")).toHaveLength(1);
    expect(db.pragma("journal_mode")).toBeUndefined();
  });
});
