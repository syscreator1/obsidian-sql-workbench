export function splitSqlStatements(sqlText: string): string[] {
  const lines = (sqlText ?? "").split(/\r?\n/);
  const stmts: string[] = [];
  let buf: string[] = [];

  const flush = () => {
    const s = buf.join("\n").trim();
    buf = [];
    if (s) stmts.push(s);
  };

  for (const raw of lines) {
    const line = raw;

    // Standalone ";" line (leading/trailing whitespace allowed)
    if (line.trim() === ";") {
      flush();
      continue;
    }

    buf.push(line);
  }

  flush();
  return stmts;
}
