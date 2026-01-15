export function toLeadingCommas(sqlText: string): string {
  const lines = sqlText.split(/\r?\n/);

  for (let i = 0; i + 1 < lines.length; i++) {
    const cur = lines[i];
    const next = lines[i + 1];

    if (cur === undefined || next === undefined) continue;

    // Detect a trailing comma (lightly strip trailing line comments before checking)
    const curNoComment = cur.replace(/--.*$/, "");
    if (!curNoComment.trimEnd().endsWith(",")) continue;

    // If the next line is blank or a comment line, do not move the comma (safer)
    if (next.trim() === "") continue;
    if (next.trimStart().startsWith("--")) continue;

    // If the next line already has a leading comma, avoid doubling
    if (next.trimStart().startsWith(",")) {
      lines[i] = cur.replace(/,(?=\s*(--.*)?$)/, "");
      continue;
    }

    // Remove the trailing comma from the current line
    lines[i] = cur.replace(/,(?=\s*(--.*)?$)/, "");

    // Preserve the next line's indentation and prefix it with ", "
    const m = next.match(/^(\s*)(.*)$/);
    const indent = m?.[1] ?? "";
    const rest = m?.[2] ?? next;
    lines[i + 1] = `${indent}, ${rest}`;
  }

  return lines.join("\n");
}

export function toTrailingCommas(sqlText: string): string {
  const lines = sqlText.split(/\r?\n/);

  for (let i = 1; i < lines.length; i++) {
    const cur = lines[i];
    const prev = lines[i - 1];
    if (cur === undefined || prev === undefined) continue;

    const m = cur.match(/^(\s*),\s+(.*)$/);
    if (!m) continue;

    // If the previous line is blank or a comment line, do not move (safer)
    if (prev.trim() === "") continue;
    if (prev.trimStart().startsWith("--")) continue;

    // Remove the leading ", " from the current line
    lines[i] = (m[1] ?? "") + (m[2] ?? "");

    // Append "," to the end of the previous line
    lines[i - 1] = prev.replace(/\s*$/, "") + ",";
  }

  return lines.join("\n");
}
