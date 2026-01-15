import type { DbClient, QueryResult } from "./DbClient";
import type { DbProfile } from "../settings";

type SqlModule = typeof import("mssql");

export class SqlServerClient {
  private pool: any | null = null;
  private sql: SqlModule | null = null;

  private getSql(): SqlModule {
    if (!this.sql) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.sql = require("mssql") as SqlModule;
    }
    return this.sql;
  }

  async query(config: any, sqlText: string) {
    const sql = this.getSql();

    if (!this.pool || !this.pool.connected) {
      this.pool = await new sql.ConnectionPool(config).connect();
    }
    return this.pool.request().query(sqlText);
  }

  async close() {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
  }
}

export function createSqlServerClient(mssql: any, p: DbProfile): DbClient {
  const encrypt = toBool(
    p.options?.encrypt ?? (p as any).encrypt,
    false // ← ★既定は false 推奨
  );

  const trust = toBool(p.trustServerCertificate, true);

  const pool = new mssql.ConnectionPool({
    server: p.host,
    port: p.port,
    database: p.database,
    user: p.user,
    password: p.password,

    options: {
      encrypt,
      trust,
      readOnlyIntent: p.readonly ?? false,
    },

    pool: {
      max: 2,
      min: 0,
      idleTimeoutMillis: 30_000,
    },
  });

  const poolConnect = pool.connect();

  return {
    async query(sql: string): Promise<QueryResult> {
      await poolConnect;

      const result = await pool.request().query(sql);

      const rows = result.recordset ?? [];
      const columns =
        rows.length > 0 ? Object.keys(rows[0]) : [];

      return {
        columns,
        rows,
        rowsAffected: result.rowsAffected,
      };
    },

    async close(): Promise<void> {
      try {
        await pool.close();
      } catch {
        /* ignore */
      }
    },
  };
}

function toBool(v: any, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  if (typeof v === "number") return v !== 0;
  return fallback;
}