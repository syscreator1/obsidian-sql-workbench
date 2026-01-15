import type { DbClient, QueryResult } from "./DbClient";
import type { DbProfile } from "../settings";

/**
 * PostgreSQL client factory.
 *
 * pg has ESM/CJS differences depending on version and bundler,
 * so we accept it as `any` for maximum compatibility.
 */
export function createPostgresClient(pg: any, p: DbProfile): DbClient {
  const { Pool } = pg;

  const pool = new Pool({
    host: p.host,
    port: p.port,
    database: p.database,
    user: p.user,
    password: p.password,

    // Can be exposed as settings later if needed
    // ssl: { rejectUnauthorized: false },

    max: 2,
  });

  /**
   * Apply readonly mode per connection (best-effort).
   * This may fail depending on server configuration or permissions,
   * so errors are intentionally ignored.
   */
  pool.on("connect", async (client: any) => {
    if (p.readonly) {
      try {
        await client.query("SET default_transaction_read_only = on;");
      } catch {
        // Ignore errors to stay on the safe side
      }
    }
  });

  return {
    async query(sql: string): Promise<QueryResult> {
      const res = await pool.query(sql);

      const rows = res.rows ?? [];

      // Prefer column names from the first row.
      // Fallback to fields metadata if no rows are returned.
      const columns =
        rows.length > 0
          ? Object.keys(rows[0])
          : (res.fields?.map((f: any) => f.name) ?? []);

      return {
        columns,
        rows,
        rowsAffected: [res.rowCount ?? 0],
      };
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
