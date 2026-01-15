 /**
 * Merge:
 *   SELECT
 *     TOP 10 ...
 * => SELECT TOP 10
 *    ...
 *
 * Also supports:
 *   SELECT DISTINCT
 *     TOP (10) PERCENT WITH TIES ...
 * => SELECT DISTINCT TOP (10) PERCENT WITH TIES
 *    ...
 */
export function mergeSelectTop(sqlText: string): string {
  const lines = sqlText.split(/\r?\n/);
  const out: string[] = [];

  // SELECT line: "SELECT", "SELECT DISTINCT", "SELECT ALL"
  const reSelect = /^(\s*)SELECT(?:\s+(DISTINCT|ALL))?\s*$/i;

  // TOP line: "TOP 10", "TOP(10)", "TOP ( @n )", with optional PERCENT / WITH TIES
  // Capture:
  //  1: indent
  //  2: value token: "(...)" or non-space token
  //  3: " PERCENT" (optional)
  //  4: " WITH TIES" (optional)
  //  5: rest (columns etc.)
  const reTop =
    /^(\s*)TOP\s+(\(\s*[^)]*?\s*\)|\S+)(\s+PERCENT)?(\s+WITH\s+TIES)?\b(.*)$/i;

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i] ?? "";
    const next = lines[i + 1] ?? "";

    const mSel = cur.match(reSelect);
    const mTop = next.match(reTop);

    if (mSel && mTop) {
      const selectIndent = mSel[1] ?? "";
      const selModifier = (mSel[2] ?? "").toUpperCase(); // DISTINCT / ALL / ""
      const topIndent = mTop[1] ?? "";

      const topValue = (mTop[2] ?? "").trim(); // "10" or "(10)" or "(@n)" etc.
      const percent = (mTop[3] ?? "").toUpperCase(); // " PERCENT" or ""
      const withTies = (mTop[4] ?? "").toUpperCase(); // " WITH TIES" or ""
      const rest = (mTop[5] ?? ""); // columns etc. (may include leading spaces)

      // Build: SELECT [DISTINCT|ALL] TOP <value> [PERCENT] [WITH TIES]
      const parts: string[] = [];
      parts.push("SELECT");
      if (selModifier) parts.push(selModifier);
      parts.push("TOP", topValue);
      if (percent) parts.push(percent.trim());
      if (withTies) parts.push(withTies.trim());

      out.push(selectIndent + parts.join(" "));

      // Keep the remaining columns line (if any)
      if (rest.trim().length > 0) {
        out.push(topIndent + rest.trimStart());
      }

      i++; // consume next (TOP...) line
      continue;
    }

    out.push(cur);
  }

  return out.join("\n");
}
