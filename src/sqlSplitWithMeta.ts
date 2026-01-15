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
    // Attach a snapshot of the current metadata to the finalized SQL
    out.push({ sql, meta: { ...currentMeta } });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    // --- Meta line (treated as metadata even if the value is empty; not included in SQL) ---
    if (trimmed.startsWith("--")) {
      const m = trimmed.match(META_LINE_RE);
      if (m) {
        // Do NOT flush here (statement boundaries are defined only by ;)
        // Update metadata only when a value exists (empty values are treated as template lines)
        const meta = parseSqlMeta(line + "\n");
        if (meta && Object.keys(meta).length > 0) {
          currentMeta = { ...currentMeta, ...meta };
        }
        continue; // Meta lines are not included in SQL
      }
      // Non-meta comments are kept as part of the SQL if needed
    }

    // Treat a standalone ";" line as a statement delimiter
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
