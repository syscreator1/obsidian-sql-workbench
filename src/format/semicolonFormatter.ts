export function moveSemicolonToOwnLine(sql: string): string {
  const lines = sql.split(/\r?\n/);
  const result: string[] = [];

  for (const line of lines) {
    // Already a semicolon-only line → normalize to ";"
    if (/^\s*;\s*$/.test(line)) {
      result.push(";");
      continue;
    }

    // Line ending with ";" (including trailing spaces or tabs)
    // Example: "abc   ;" → split into "abc" and ";"
    const m = line.match(/^(.*?)(\s*);\s*$/);
    if (m) {
      const body = (m[1] ?? "").trimEnd();
      if (body.length > 0) result.push(body);
      result.push(";");
      continue;
    }

    // Otherwise, keep the line as-is
    result.push(line);
  }

  return result.join("\n");
}
