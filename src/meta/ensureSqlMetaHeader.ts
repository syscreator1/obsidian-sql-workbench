export const DEFAULT_SQL_META_HEADER = [
  "-- profile(optional):",
  "-- tags(CSV):",
  "-- danger(low/medium/high): low",
  "-- owner(optional):",
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

  // If the leading comment block contains no meta at all -> prepend the whole header
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

  // Fill missing fields (profile goes to the top, others go to the end)
  const missingTop: string[] = [];
  const missingRest: string[] = [];

  if (!found.has("profile")) missingTop.push("-- profile(optional):");

  if (!found.has("tags")) missingRest.push("-- tags(CSV):");
  if (!found.has("danger")) missingRest.push("-- danger(low/medium/high): low");
  if (!found.has("owner")) missingRest.push("-- owner(optional):");
  if (!found.has("note")) missingRest.push("-- note(free text):");

  if (missingTop.length === 0 && missingRest.length === 0) {
    return { changed: false, text };
  }

  const lines = body.split(/\r?\n/);

  // Find the start of the comment block (after skipping blank lines)
  let headerStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line.trim() === "") continue;
    headerStart = i;
    break;
  }

  // Insert profile at the top
  if (missingTop.length > 0) {
    lines.splice(headerStart, 0, ...missingTop);
  }

  // Compute insertion point at the end of the leading comment block
  // (recompute against the updated lines after inserting profile)
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

  // Insert tags/danger/owner/note at the end
  const toInsert = [...missingRest];

  // Keep a blank line after the meta block
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
