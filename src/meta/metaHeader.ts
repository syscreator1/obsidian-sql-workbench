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
    if (value == null) continue; // strict対策

    const row = header.createDiv({ cls: "sql-inline-meta__row" });
    row.createSpan({ cls: "sql-inline-meta__key", text: key.toUpperCase() });

    if (key === "tags") {
      // tags: aras, migration
      // tags: [aras, migration]
      // tags: ["aras","migration"]
      // tags: ['aras','migration']
      let raw = value.trim();

      // [ ... ] 形式なら括弧を外す
      if (raw.startsWith("[") && raw.endsWith("]")) {
        raw = raw.slice(1, -1).trim();
      }

      // 要素を分割して、余分なクォートを除去
      const tags = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/^['"]|['"]$/g, "")) // 先頭末尾の ' or " を落とす
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

          // Alt：削除
          if (ev.altKey) {
            await plugin?.openSqlWorkbenchSearchSidebar?.(t, { action: "remove" });
            return;
          }

          // Ctrl：AND 追加
          if (ev.ctrlKey) {
            await plugin?.openSqlWorkbenchSearchSidebar?.(t, { action: "add", mode: "AND" });
            return;
          }

          // Shift：OR 追加
          if (ev.shiftKey) {
            await plugin?.openSqlWorkbenchSearchSidebar?.(t, { action: "add", mode: "OR" });
            return;
          }

          // 通常：リセット（単独）
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
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/); // ← BOM除去

  let started = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // 先頭の空行は無視
    if (!started && trimmed === "") continue;

    started = true;

    // コメントでなければ終了
    if (!trimmed.startsWith("--")) break;

    // -- tags(任意): value
    // -- danger(low/medium/high): low
    const match = trimmed.match(/^--\s*([A-Za-z0-9_-]+)(?:\([^)]*\))?\s*:\s*(.*)\s*$/);
    if (!match) continue;

    const rawKey = match[1] ?? "";
    const rawVal = match[2] ?? "";

    // 値の後ろに付けた説明コメント（ -- ... ）は除去（任意）
    const parts = rawVal.split(/\s+--\s+/);
    const value = (parts[0] ?? "").trim();

    const key = rawKey.toLowerCase();

    // 空値は「未設定」として扱う（任意：保存しない）
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
        meta: { ...currentMeta }, // ★その時点のメタをコピー
      });
    }
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // メタタグ行
    if (line.trim().startsWith("--")) {
      const meta = parseSqlMeta(line + "\n"); // 1行だけでもOK
      if (Object.keys(meta).length > 0) {
        // 直前の SQL を確定
        flush();

        // ★ currentMeta を更新
        currentMeta = { ...currentMeta, ...meta };
        continue;
      }
    }

    // SQL 文の終端
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
