export function normalizeTags(raw: string): string[] {
  let s = raw.trim().toLowerCase();

  // [a,b] / ["a","b"] / ['a','b']
  if (s.startsWith("[") && s.endsWith("]")) {
    s = s.slice(1, -1);
  }

  return s
    .split(",")
    .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}
