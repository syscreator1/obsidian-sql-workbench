export function toLeadingCommas(sqlText: string): string {
  const lines = sqlText.split(/\r?\n/);

  for (let i = 0; i + 1 < lines.length; i++) {
    const cur = lines[i];
    const next = lines[i + 1];

    if (cur === undefined || next === undefined) continue;

    // 行末カンマ判定（末尾コメントは軽く除去して判定）
    const curNoComment = cur.replace(/--.*$/, "");
    if (!curNoComment.trimEnd().endsWith(",")) continue;

    // 次行が空行・コメント行なら、カンマ移動しない（安全側）
    if (next.trim() === "") continue;
    if (next.trimStart().startsWith("--")) continue;

    // すでに次行が前カンマなら二重回避
    if (next.trimStart().startsWith(",")) {
      lines[i] = cur.replace(/,(?=\s*(--.*)?$)/, "");
      continue;
    }

    // 現行末尾のカンマを削る
    lines[i] = cur.replace(/,(?=\s*(--.*)?$)/, "");

    // 次行のインデントを維持して先頭に ", " を付ける
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

    // 前行が空行・コメント行なら移動しない（安全側）
    if (prev.trim() === "") continue;
    if (prev.trimStart().startsWith("--")) continue;

    // 現行の先頭 ", " を除去
    lines[i] = (m[1] ?? "") + (m[2] ?? "");

    // 前行の末尾に ","
    lines[i - 1] = prev.replace(/\s*$/, "") + ",";
  }

  return lines.join("\n");
}
