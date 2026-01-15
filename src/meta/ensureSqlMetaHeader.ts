export const DEFAULT_SQL_META_HEADER = [
  "-- profile(任意):",
  "-- tags(CSV):",
  "-- danger(low/medium/high): low",
  "-- owner(任意):",
  "-- note(free text):",
  "",
];

type MetaKey = "profile" | "tags" | "danger" | "owner" | "note";

function scanMetaHeaderKeys(text: string): Set<MetaKey> {
  const body = text.replace(/^\uFEFF/, "");
  const lines = body.split(/\r?\n/);

  const found = new Set<MetaKey>();
  let started = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!started && trimmed === "") continue;
    started = true;

    if (!trimmed.startsWith("--")) break;

    if (/^--\s*profile(?:\([^)]*\))?\s*:/.test(trimmed)) found.add("profile");
    if (/^--\s*tags(?:\([^)]*\))?\s*:/.test(trimmed)) found.add("tags");
    if (/^--\s*danger(?:\([^)]*\))?\s*:/.test(trimmed)) found.add("danger");
    if (/^--\s*owner(?:\([^)]*\))?\s*:/.test(trimmed)) found.add("owner");
    if (/^--\s*note(?:\([^)]*\))?\s*:/.test(trimmed)) found.add("note");
  }

  return found;
}

export function ensureSqlMetaHeader(text: string): { changed: boolean; text: string } {
  const hasBom = text.startsWith("\uFEFF");
  const body = hasBom ? text.slice(1) : text;

  const found = scanMetaHeaderKeys(body);

  // 先頭コメントブロックに meta が1つも無い場合 → まるごと追加
  const hasAnyMeta =
    found.has("profile") ||
    found.has("tags") ||
    found.has("danger") ||
    found.has("owner") ||
    found.has("note");

  if (!hasAnyMeta) {
    const header = DEFAULT_SQL_META_HEADER.join("\n");
    const newText = (hasBom ? "\uFEFF" : "") + header + body;
    return { changed: true, text: newText };
  }

  // 不足補完（profileは先頭、それ以外は末尾へ）
  const missingTop: string[] = [];
  const missingRest: string[] = [];

  if (!found.has("profile")) missingTop.push("-- profile(任意):");

  if (!found.has("tags")) missingRest.push("-- tags(CSV):");
  if (!found.has("danger")) missingRest.push("-- danger(low/medium/high): low");
  if (!found.has("owner")) missingRest.push("-- owner(任意):");
  if (!found.has("note")) missingRest.push("-- note(free text):");

  if (missingTop.length === 0 && missingRest.length === 0) {
    return { changed: false, text };
  }

  const lines = body.split(/\r?\n/);

  // コメントブロック開始位置（空行スキップ後）
  let headerStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line.trim() === "") continue;
    headerStart = i;
    break;
  }

  // profile は先頭に差し込む
  if (missingTop.length > 0) {
    lines.splice(headerStart, 0, ...missingTop);
  }

  // 先頭コメントブロックの最後に差し込む位置を計算（profile挿入後のlinesで再計算）
  let insertAt = 0;
  let started = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    const trimmed = line.trim();
    if (!started && trimmed === "") continue;
    started = true;

    if (!trimmed.startsWith("--")) {
      insertAt = i;
      break;
    }
    insertAt = i + 1;
  }

  // tags/danger/owner/note を末尾に差し込む
  const toInsert = [...missingRest];

  // メタブロック直後を空行で揃える
  if (toInsert.length > 0) {
    const next = lines[insertAt];
    if (insertAt === lines.length || (next?.trim() ?? "") !== "") {
      toInsert.push("");
    }
    lines.splice(insertAt, 0, ...toInsert);
  }

  const newBody = lines.join("\n");
  return { changed: true, text: (hasBom ? "\uFEFF" : "") + newBody };
}
