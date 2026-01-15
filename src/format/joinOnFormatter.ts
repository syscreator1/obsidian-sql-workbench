export function formatJoinOnOnly(
  sqlText: string,
  indentSize: number
): string {
  const indentUnit = " ".repeat(indentSize);
  const srcLines = sqlText.split(/\r?\n/);
  const lines: string[] = [];

  // FROM 配下の最初の実テーブル行のインデントを基準にする
  let tableIndent = "";
  
  for (let i = 0; i < srcLines.length; i++) {
    if (/^\s*FROM\s*$/i.test(srcLines[i] ?? "")) {
      for (let j = i + 1; j < srcLines.length; j++) {
        const s = srcLines[j] ?? "";
        if (s.trim() === "") continue;
        tableIndent = s.match(/^(\s*)/)?.[1] ?? "";
        break;
      }
      break;
    }
  }

  // --- 1) JOIN 行に ON が同居していたら分割 ---
  for (const line of srcLines) {
    if (line === undefined) continue;

    if (/\bJOIN\b/i.test(line) && /\bON\b/i.test(line) && !/^\s*ON\b/i.test(line)) {
      const m = line.match(/^(\s*)(.*?\bJOIN\b.*?)(\s+)(ON\b.*)$/i);
      if (m) {
        const baseIndent = m[1] ?? "";
        const joinPart = m[2] ?? "";
        const onPart = m[4] ?? "";

        lines.push(`${baseIndent}${joinPart.trimEnd()}`);
        lines.push(`${baseIndent}${indentUnit}${onPart.trimStart()}`);

        continue;
      }
    }

    lines.push(line);
  }

  // --- 2) JOIN 条件ブロック内の ON / AND / OR を揃える ---
  const out = [...lines];

  // ★派生テーブル（JOIN ( ... )）の行インデックス範囲をマークする
  const skip = new Set<number>();

  // JOIN ( から対応する ) までをスキップ対象にする（ネストも対応）
  for (let i = 0; i < out.length; i++) {
    const s = out[i] ?? "";
    if (!/\bJOIN\b/i.test(s) || !/\(\s*$/.test(s)) continue; // JOIN ( の行だけ

    let depth = 0;
    for (let j = i; j < out.length; j++) {
      const line = out[j] ?? "";

      // ざっくり括弧カウント（SQL文字列内までは見ない：ここは安全側で十分）
      const opens = (line.match(/\(/g) ?? []).length;
      const closes = (line.match(/\)/g) ?? []).length;
      depth += opens - closes;

      // JOIN( 行自身も含めてスキップ
      skip.add(j);

      if (j > i && depth <= 0) break; // 対応する ) で終わり
    }
  }

  const isClauseStart = (s: string) =>
    /^\s*(WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|UNION|EXCEPT|INTERSECT)\b/i.test(s);

  const isJoinStart = (s: string) =>
    /^\s*(INNER|LEFT|RIGHT|FULL|CROSS)?\s*JOIN\b/i.test(s) || /^\s*JOIN\b/i.test(s);

  let inJoinCond = false;
  let joinIndent = "";
  let derivedDepth = 0; // ★追加：派生テーブル( JOIN ( ... ) ) の深さ
  
  for (let i = 0; i < out.length; i++) {
    if (skip.has(i)) {
      // ただし ") xp ON ..." のように閉じ括弧行にONが同居するケースは分割したいので例外
      const line = out[i] ?? "";
      if (!/^\s*\)\s+\S+\s+ON\b/i.test(line)) {
        continue;
      }
      // ↑この例外に該当する場合は下の ") xp ON" 分割ロジックに任せる
    }

    const line = out[i];
    if (line === undefined) continue;
  
    // ★追加：派生テーブル開始 "JOIN (" を検出したら derivedDepth++
    if (/\bJOIN\b/i.test(line) && /\(\s*$/.test(line)) {
      derivedDepth++;
      // JOIN( 行はトップレベルJOINとして扱うなら、ここでは continue しない
      // → ただし次行以降(中身)は触らない
    }
  
    // ★追加：派生テーブル中は中身を一切整形しない（ただし閉じ括弧は検出したい）
    if (derivedDepth > 0) {
      // 閉じ括弧っぽい行が来たら depth を戻す（")", ") xp" など）
      if (/^\s*\)/.test(line)) {
        derivedDepth = Math.max(0, derivedDepth - 1);
        // ") xp ON ..." の分割ロジックは “derivedDepthを戻した後” に効かせたいので continue しない
      } else {
        continue; // 中身（SELECT〜JOIN〜ON〜AND等）には触らない
      }
    }
  
    if (isClauseStart(line)) {
      inJoinCond = false;
      joinIndent = "";
      continue;
    }

    if (isJoinStart(line)) {
      joinIndent = tableIndent + indentUnit;      // ←再宣言しない
      out[i] = `${joinIndent}${line.trimStart()}`; // JOIN行を2段に揃える
      inJoinCond = true;
      continue;
    }

    if (!inJoinCond) continue;

    // ★派生テーブルの閉じ括弧行: ") xp ON ..." を分割して整形
    // 例: ") xp ON ep.id = xp.item_id"
    {
      const mClose = line.match(/^\s*(\)\s+\S+)\s+(ON\b.*)$/i);
      if (mClose) {
        const left = mClose[1] ?? "";   // ") xp"
        const onPart = mClose[2] ?? ""; // "ON ..."

        // ") xp" を JOIN と同じ階層（FROMより1段深い）に寄せる
        out[i] = `${joinIndent}${left.trimStart()}`; // ) xp は JOIN と同じ
        out.splice(i + 1, 0, `${joinIndent}${indentUnit}${onPart.trimStart()}`); // ON は +1段

        // 挿入したので次行をスキップ
        i++;
        continue;
      }
    }

    // 既存：JOIN 条件ブロック内の ON / AND / OR を揃える
    const m = line.match(/^(\s*)(ON|AND|OR)\b(.*)$/i);
    if (!m) continue;


    const kw = (m[2] ?? "").toUpperCase();
    const rest = m[3] ?? "";
    const onIndent = tableIndent + indentUnit + indentUnit;
    
    out[i] = `${joinIndent}${indentUnit}${kw}${rest}`;

  }

  return out.join("\n");
}

export function formatDerivedJoinBlocks(
  sqlText: string,
  indentSize: number
): string {
  const indentUnit = " ".repeat(indentSize);
  const out = sqlText.split(/\r?\n/);

  const rtrim = (s: string) => s.replace(/\s+$/, "");
  const leading = (s: string) => ((s.match(/^(\s*)/)?.[1] ?? "").replace(/\t/g, indentUnit));
  const countChar = (s: string, ch: string) => (s.match(new RegExp(`\\${ch}`, "g")) ?? []).length;

  const isClauseStart = (s: string) =>
    /^\s*(WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|UNION|EXCEPT|INTERSECT)\b/i.test(s);

  const isJoinLine = (s: string) =>
    /^\s*(INNER|LEFT|RIGHT|FULL|CROSS)?\s*JOIN\b/i.test(s) || /^\s*JOIN\b/i.test(s);

  for (let i = 0; i < out.length; i++) {
    const raw = out[i] ?? "";
    const line = rtrim(raw);

    // 派生テーブル開始："... JOIN (" で終わる行
    if (!/\bJOIN\b/i.test(line) || !/\(\s*$/.test(line)) continue;

    // JOIN( 行のインデントは「FROM直下のテーブル行 + 1段」に固定する
    let joinIndent = leading(raw);

    // 1) FROM の次の “テーブル行” のインデントを探す（innovator.Part p の行）
    let tableIndent = "";
    for (let x = 0; x < out.length; x++) {
      if (/^\s*FROM\s*$/i.test(out[x] ?? "")) {
        for (let y = x + 1; y < out.length; y++) {
          const s = out[y] ?? "";
          if (s.trim() === "") continue;
          tableIndent = leading(s);
          break;
        }
        break;
      }
    }

    // 2) 見つかったら JOIN( はテーブル行 + 1段（=4スペース）に揃える
    if (tableIndent !== "") {
      joinIndent = tableIndent + indentUnit;
    }

    const insideBaseIndent = joinIndent + indentUnit;

    out[i] = joinIndent + out[i]!.trimStart();

    // 対応する閉じ括弧行を括弧深さで探す（") xp" まで）
    let depth = 0;
    let closeIdx = -1;
    for (let j = i; j < out.length; j++) {
      const s = out[j] ?? "";
      depth += countChar(s, "(") - countChar(s, ")");
      if (j > i && depth <= 0) {
        closeIdx = j;
        break;
      }
    }
    if (closeIdx < 0) continue;

    // ブロック内部（i+1～closeIdx-1）の最小インデント長（相対維持用）
    let minIndentLen: number | null = null;
    for (let j = i + 1; j < closeIdx; j++) {
      const s = out[j];
      if (s === undefined) continue;

      const t = s.trim();
      if (t === "" || t.startsWith("--")) continue;

      const ind = leading(s);
      minIndentLen = minIndentLen === null ? ind.length : Math.min(minIndentLen, ind.length);
    }
    if (minIndentLen === null) {
      out[closeIdx] = joinIndent + (out[closeIdx] ?? "").trimStart();
      i = closeIdx;
      continue;
    }

    // 1) まずブロック全体を「JOIN( + 1段」に rebasing（相対インデント維持）
    for (let j = i + 1; j < closeIdx; j++) {
      const s = out[j];
      if (s === undefined) continue;

      const t = s.trim();
      if (t === "" || t.startsWith("--")) continue;

      const ind = leading(s);
      const rel = ind.slice(minIndentLen); // 相対インデント（文字列として保持）
      const body = s.trimStart();

      out[j] = insideBaseIndent + rel + body;
    }

    // 閉じ括弧行は JOIN( と同じインデント
    out[closeIdx] = joinIndent + (out[closeIdx] ?? "").trimStart();

    // 2) ★追加：派生サブクエリ内の FROM 直下 JOIN を強制段付け
    //   - FROM の「実テーブル行（例: xp.XPROPERTYVALUES x0）」のインデントを基準に
    //   - JOIN は +1段
    //   - ON/AND/OR は +2段（= JOIN より +1段）
    let inFromBlock = false;
    let baseFromIndentLen = -1;
    let baseJoinIndentLen = -1;

    for (let j = i + 1; j < closeIdx; j++) {
      const s = out[j] ?? "";
      const t = s.trim();
      if (t === "" || t.startsWith("--")) continue;

      if (isClauseStart(s)) {
        inFromBlock = false;
        baseFromIndentLen = -1;
        baseJoinIndentLen = -1;
        continue;
      }

      // "FROM" 行を見つけたら、次の非空行を「実テーブル行」として基準にする
      if (/^\s*FROM\s*$/i.test(s)) {
        inFromBlock = true;
        baseFromIndentLen = -1;
        baseJoinIndentLen = -1;
        continue;
      }

      if (inFromBlock && baseFromIndentLen < 0) {
        // FROM直後の実テーブル行（例: xp.XPROPERTYVALUES x0）
        baseFromIndentLen = leading(s).length;
        continue;
      }

      // FROM ブロック中の JOIN を強制（FROM実テーブル行 +1段）
      if (inFromBlock && baseFromIndentLen >= 0 && isJoinLine(s)) {
        const desired = baseFromIndentLen + indentUnit.length;
        out[j] = " ".repeat(desired) + s.trimStart();
        baseJoinIndentLen = desired;
        continue;
      }

      // JOIN 直下の ON/AND/OR を強制（JOIN +1段）
      if (inFromBlock && baseJoinIndentLen >= 0) {
        const m = s.match(/^\s*(ON|AND|OR)\b(.*)$/i);
        if (m) {
          const kw = (m[1] ?? "").toUpperCase();
          const rest = m[2] ?? "";
          const desired = baseJoinIndentLen + indentUnit.length;
          out[j] = " ".repeat(desired) + kw + rest;
        }
      }
    }

    i = closeIdx;
  }

  return out.join("\n");
}
