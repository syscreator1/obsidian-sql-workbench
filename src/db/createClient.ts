import type { DbProfile } from "../settings";
import type { DbClient } from "./DbClient";
import { createSqlServerClient } from "./SqlServerClient";
import { createPostgresClient } from "./PostgresClient";
// 既存: createSqlServerClient など

export async function createClient(profile: DbProfile): Promise<DbClient> {
  switch (profile.type) {
    case "sqlserver": {
      const mssql = (await import("mssql")) as any;
      return createSqlServerClient(mssql, profile);
    }
    case "postgres": {
      const pg = await import("pg"); // @types/pg が入っていれば型もOK
      return createPostgresClient(pg as any, profile);
    }
    default:
      throw new Error(`Unsupported DB type: ${profile.type}`);
  }
}
