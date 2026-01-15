export function moveSemicolonToOwnLine(sql: string): string {
  const lines = sql.split(/\r?\n/);
  const result: string[] = [];

  for (const line of lines) {
    // すでにセミコロン単独行 → 正規化して ";" に統一
    if (/^\s*;\s*$/.test(line)) {
      result.push(";");
      continue;
    }

    // 行末が ";" のケース（空白やタブ込み）
    // 例: "abc   ;" → "abc" と ";" に分離
    const m = line.match(/^(.*?)(\s*);\s*$/);
    if (m) {
      const body = (m[1] ?? "").trimEnd();
      if (body.length > 0) result.push(body);
      result.push(";");
      continue;
    }

    // それ以外はそのまま
    result.push(line);
  }

  return result.join("\n");
}
