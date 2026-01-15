// src/sqlSplitWithMeta.ts
import { parseSqlMeta, type SqlMeta } from "./meta/metaHeader";

export type SqlChunk = {
  sql: string;
  meta: SqlMeta;
};

const META_LINE_RE = /^--\s*([A-Za-z0-9_-]+)(?:\([^)]*\))?\s*:\s*(.*)\s*$/;

export function splitSqlStatementsWithMeta(text: string): SqlChunk[] {
  const lines = (text ?? "").split(/\r?\n/);

  let currentMeta: SqlMeta = {};
  let buf: string[] = [];
  const out: SqlChunk[] = [];

  const flush = () => {
    const sql = buf.join("\n").trim();
    buf = [];
    if (!sql) return;
    // ★確定したSQLに、その時点のメタをスナップショット付与
    out.push({ sql, meta: { ...currentMeta } });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    // --- メタ行（値が空でもメタ扱いしてSQLに入れない）---
    if (trimmed.startsWith("--")) {
      const m = trimmed.match(META_LINE_RE);
      if (m) {
        // ★ここで flush しない！（文境界は ; のみ）
        // 値がある場合だけ meta を更新（空ならテンプレ行として無視）
        const meta = parseSqlMeta(line + "\n");
        if (meta && Object.keys(meta).length > 0) {
          currentMeta = { ...currentMeta, ...meta };
        }
        continue; // メタ行はSQLに入れない
      }
      // メタ形式じゃないコメントはSQLの一部として残す（必要なら）
    }

    // ";" を単独行として区切る仕様
    if (trimmed === ";") {
      buf.push(line);
      flush();
      continue;
    }

    buf.push(line);
  }

  flush();
  return out;
}
