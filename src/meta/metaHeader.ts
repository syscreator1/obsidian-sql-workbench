import {
  App,
} from "obsidian";

import { openSearchWithQuery } from "../main";

export type SqlMeta = Record<string, string>;

export function renderMetaHeader(app: App, container: HTMLElement, meta: SqlMeta) {
  const keys = Object.keys(meta);
  if (keys.length === 0) return;

  const header = container.createDiv({ cls: "sql-inline-meta" });

  const order = ["tags", "danger", "runtime", "owner", "note"];
  const sortedKeys = [
    ...order.filter((k) => meta[k] != null),
    ...keys.filter((k) => !order.includes(k)),
  ];

  for (const key of sortedKeys) {
    const value = meta[key];
    if (value == null) continue; // strict workaround

    const row = header.createDiv({ cls: "sql-inline-meta__row" });
    row.createSpan({ cls: "sql-inline-meta__key", text: key.toUpperCase() });

    if (key === "tags") {
      // tags: aras, migration
      // tags: [aras, migration]
      // tags: ["aras","migration"]
      // tags: ['aras','migration']
      let raw = value.trim();

      // If it's in [ ... ] format, strip the brackets
      if (raw.startsWith("[") && raw.endsWith("]")) {
        raw = raw.slice(1, -1).trim();
      }

      // Split elements and remove extra quotes
      const tags = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/^['"]|['"]$/g, "")) // Remove leading/trailing ' or "
        .filter(Boolean);

      const tagWrap = row.createSpan({ cls: "sql-inline-meta__tags" });
      for (const t of tags) {
        const tagEl = tagWrap.createSpan({ cls: "sql-inline-meta__tag is-clickable", text: t });
        tagEl.setAttr("role", "button");
        tagEl.setAttr("tabindex", "0");
        tagEl.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();

          const plugin = (app as any).plugins?.getPlugin?.("sql-workbench");

          // Alt: remove
          if (ev.altKey) {
            await plugin?.openSqlWorkbenchSearchSidebar?.(t, { action: "remove" });
            return;
          }

          // Ctrl: add with AND
          if (ev.ctrlKey) {
            await plugin?.openSqlWorkbenchSearchSidebar?.(t, { action: "add", mode: "AND" });
            return;
          }

          // Shift: add with OR
          if (ev.shiftKey) {
            await plugin?.openSqlWorkbenchSearchSidebar?.(t, { action: "add", mode: "OR" });
            return;
          }

          // Default: reset (single tag)
          await plugin?.openSqlWorkbenchSearchSidebar?.(t, { action: "set" });
        });
        tagEl.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            openSearchWithQuery(app, t);
          }
        });
      }

      continue;
    }

    if (key === "danger") {
      const badge = row.createSpan({
        cls: "sql-inline-meta__danger",
        text: value,
      });
      badge.dataset.level = value.toLowerCase();
      continue;
    }

    row.createSpan({ cls: "sql-inline-meta__value", text: value });
  }
}

export function parseSqlMeta(text: string): SqlMeta {
  const meta: SqlMeta = {};
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/); // ← Strip BOM

  let started = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Ignore leading blank lines
    if (!started && trimmed === "") continue;

    started = true;

    // Stop when the line is not a comment
    if (!trimmed.startsWith("--")) break;

    // -- tags(optional): value
    // -- danger(low/medium/high): low
    const match = trimmed.match(/^--\s*([A-Za-z0-9_-]+)(?:\([^)]*\))?\s*:\s*(.*)\s*$/);
    if (!match) continue;

    const rawKey = match[1] ?? "";
    const rawVal = match[2] ?? "";

    // Remove trailing explanatory comments appended after the value ( -- ... ) (optional)
    const parts = rawVal.split(/\s+--\s+/);
    const value = (parts[0] ?? "").trim();

    const key = rawKey.toLowerCase();

    // Treat empty values as "unset" (optional: don't store)
    if (!value) continue;

    if (meta[key]) meta[key] = `${meta[key]}, ${value}`;
    else meta[key] = value;
  }

  return meta;
}

function isMetaBlock(text: string): boolean {
  return /^\s*--\s*(tags|danger|owner|note)\s*[:(]/im.test(text);
}

type SqlChunk = {
  sql: string;
  meta: SqlMeta;
};

export function splitSqlWithMeta(text: string): SqlChunk[] {
  const lines = text.split(/\r?\n/);

  let currentMeta: SqlMeta = {};
  let buffer: string[] = [];
  const result: SqlChunk[] = [];

  const flush = () => {
    const sql = buffer.join("\n").trim();
    if (sql) {
      result.push({
        sql,
        meta: { ...currentMeta }, // ★ Copy the metadata at that point
      });
    }
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // Meta tag line
    if (line.trim().startsWith("--")) {
      const meta = parseSqlMeta(line + "\n"); // Works even with a single line
      if (Object.keys(meta).length > 0) {
        // Finalize the preceding SQL
        flush();

        // ★ Update currentMeta
        currentMeta = { ...currentMeta, ...meta };
        continue;
      }
    }

    // SQL statement terminator
    if (line.trim() === ";") {
      buffer.push(line);
      flush();
      continue;
    }

    buffer.push(line);
  }

  flush();
  return result;
}
