export function formatJoinOnOnly(
  sqlText: string,
  indentSize: number
): string {
  const indentUnit = " ".repeat(indentSize);
  const srcLines = sqlText.split(/\r?\n/);
  const lines: string[] = [];

  // Use the indentation of the first real table line under FROM as the baseline
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

  // --- 1) Split JOIN lines when ON is on the same line ---
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

  // --- 2) Align ON / AND / OR inside JOIN condition blocks ---
  const out = [...lines];

  // ★ Mark the line index range of derived tables (JOIN ( ... ))
  const skip = new Set<number>();

  // Skip from "JOIN (" to the matching ")" (supports nesting)
  for (let i = 0; i < out.length; i++) {
    const s = out[i] ?? "";
    if (!/\bJOIN\b/i.test(s) || !/\(\s*$/.test(s)) continue; // Only lines that are exactly "JOIN ("

    let depth = 0;
    for (let j = i; j < out.length; j++) {
      const line = out[j] ?? "";

      // Rough parenthesis counting (we don't parse SQL strings here; this conservative approach is fine)
      const opens = (line.match(/\(/g) ?? []).length;
      const closes = (line.match(/\)/g) ?? []).length;
      depth += opens - closes;

      // Skip the "JOIN(" line itself as well
      skip.add(j);

      if (j > i && depth <= 0) break; // End at the matching ")"
    }
  }

  const isClauseStart = (s: string) =>
    /^\s*(WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|UNION|EXCEPT|INTERSECT)\b/i.test(s);

  const isJoinStart = (s: string) =>
    /^\s*(INNER|LEFT|RIGHT|FULL|CROSS)?\s*JOIN\b/i.test(s) || /^\s*JOIN\b/i.test(s);

  let inJoinCond = false;
  let joinIndent = "";
  let derivedDepth = 0; // ★ Added: nesting depth for derived tables (JOIN ( ... ))
  
  for (let i = 0; i < out.length; i++) {
    if (skip.has(i)) {
      // Exception: we still want to split cases like ") xp ON ..." even if it's in a skipped range
      const line = out[i] ?? "";
      if (!/^\s*\)\s+\S+\s+ON\b/i.test(line)) {
        continue;
      }
      // If it matches the exception, let the ") xp ON" splitting logic below handle it
    }

    const line = out[i];
    if (line === undefined) continue;
  
    // ★ Added: detect the start of a derived table "JOIN (" and increment derivedDepth
    if (/\bJOIN\b/i.test(line) && /\(\s*$/.test(line)) {
      derivedDepth++;
      // If you want to treat the "JOIN(" line as a top-level JOIN, do not continue here
      // -> but do not touch the inside lines
    }
  
    // ★ Added: do not format anything inside derived tables
    // (but we still need to detect closing parentheses)
    if (derivedDepth > 0) {
      // If this looks like a closing parenthesis line, decrease depth (")", ") xp", etc.)
      if (/^\s*\)/.test(line)) {
        derivedDepth = Math.max(0, derivedDepth - 1);
        // The ") xp ON ..." splitting should run after decreasing the depth, so do not continue
      } else {
        continue; // Do not touch inner lines (SELECT/JOIN/ON/AND etc.)
      }
    }
  
    if (isClauseStart(line)) {
      inJoinCond = false;
      joinIndent = "";
      continue;
    }

    if (isJoinStart(line)) {
      joinIndent = tableIndent + indentUnit;       // ← do not redeclare
      out[i] = `${joinIndent}${line.trimStart()}`; // Align JOIN lines to one indent level under FROM
      inJoinCond = true;
      continue;
    }

    if (!inJoinCond) continue;

    // ★ Derived-table close line: split and format ") xp ON ..."
    // Example: ") xp ON ep.id = xp.item_id"
    {
      const mClose = line.match(/^\s*(\)\s+\S+)\s+(ON\b.*)$/i);
      if (mClose) {
        const left = mClose[1] ?? "";   // ") xp"
        const onPart = mClose[2] ?? ""; // "ON ..."

        // Align ") xp" to the same level as JOIN (one level under FROM)
        out[i] = `${joinIndent}${left.trimStart()}`; // ") xp" aligned with JOIN
        out.splice(i + 1, 0, `${joinIndent}${indentUnit}${onPart.trimStart()}`); // ON one more indent

        // Skip the inserted next line
        i++;
        continue;
      }
    }

    // Existing behavior: align ON / AND / OR within JOIN condition blocks
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

    // Derived table start: a line ending with "... JOIN ("
    if (!/\bJOIN\b/i.test(line) || !/\(\s*$/.test(line)) continue;

    // Fix the indentation of the "JOIN(" line to "one level under the table line under FROM"
    let joinIndent = leading(raw);

    // 1) Find the indentation of the first table line after FROM (e.g., "innovator.Part p")
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

    // 2) If found, align "JOIN(" to "tableIndent + 1 indent unit"
    if (tableIndent !== "") {
      joinIndent = tableIndent + indentUnit;
    }

    const insideBaseIndent = joinIndent + indentUnit;

    out[i] = joinIndent + out[i]!.trimStart();

    // Find the matching closing parenthesis by tracking parenthesis depth (up to ") xp")
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

    // Minimal indent length within the block (i+1..closeIdx-1) to preserve relative indentation
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

    // 1) Rebase the whole block to "JOIN( + 1 indent" while preserving relative indentation
    for (let j = i + 1; j < closeIdx; j++) {
      const s = out[j];
      if (s === undefined) continue;

      const t = s.trim();
      if (t === "" || t.startsWith("--")) continue;

      const ind = leading(s);
      const rel = ind.slice(minIndentLen); // Relative indentation (kept as a string)
      const body = s.trimStart();

      out[j] = insideBaseIndent + rel + body;
    }

    // Align the closing parenthesis line to the same indent as "JOIN("
    out[closeIdx] = joinIndent + (out[closeIdx] ?? "").trimStart();

    // 2) ★ Added: enforce indentation for JOIN under FROM inside the derived subquery
    //   - Use the indentation of the "real table line" right after FROM as the baseline
    //   - JOIN is +1 level
    //   - ON/AND/OR is +2 levels (i.e., +1 relative to JOIN)
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

      // When we see a "FROM" line, the next non-empty line becomes the base "table line"
      if (/^\s*FROM\s*$/i.test(s)) {
        inFromBlock = true;
        baseFromIndentLen = -1;
        baseJoinIndentLen = -1;
        continue;
      }

      if (inFromBlock && baseFromIndentLen < 0) {
        // The first table line right after FROM (e.g., "xp.XPROPERTYVALUES x0")
        baseFromIndentLen = leading(s).length;
        continue;
      }

      // Enforce JOIN indentation inside the FROM block (tableIndent + 1 level)
      if (inFromBlock && baseFromIndentLen >= 0 && isJoinLine(s)) {
        const desired = baseFromIndentLen + indentUnit.length;
        out[j] = " ".repeat(desired) + s.trimStart();
        baseJoinIndentLen = desired;
        continue;
      }

      // Enforce indentation for ON/AND/OR under JOIN (JOIN + 1 level)
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
