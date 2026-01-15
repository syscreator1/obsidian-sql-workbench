import type { DbClient, QueryResult } from "./DbClient";
import type { DbProfile } from "../settings";

// pg は ESM/CJS差があるので any で受けるのが安全
export function createPostgresClient(pg: any, p: DbProfile): DbClient {
  const { Pool } = pg;

  const pool = new Pool({
    host: p.host,
    port: p.port,
    database: p.database,
    user: p.user,
    password: p.password,

    // 必要なら後で settings 化
    // ssl: { rejectUnauthorized: false },
    max: 2,
  });

  // readonly をコネクション単位で効かせる（ベストエフォート）
  pool.on("connect", async (client: any) => {
    if (p.readonly) {
      try {
        await client.query("SET default_transaction_read_only = on;");
      } catch {
        // 権限やサーバ設定で失敗する場合があるので握りつぶし（安全側）
      }
    }
  });

  return {
    async query(sql: string): Promise<QueryResult> {
      const res = await pool.query(sql);

      const rows = res.rows ?? [];
      // columns: rows[0] から取れるのが一番確実。無い場合は fields から取る
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
