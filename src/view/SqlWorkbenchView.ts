import { FileView, TFile, WorkspaceLeaf, MarkdownRenderer, Notice, Modal } from "obsidian";
import type SqlWorkbenchPlugin from "../main";

import { EditorState, EditorSelection, Extension, Prec } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin } from "@codemirror/view";
import { sql } from "@codemirror/lang-sql";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, indentUnit, indentOnInput } from "@codemirror/language";
import { lineNumbers, highlightActiveLineGutter } from "@codemirror/view";

import { format as formatSql } from "sql-formatter";

import { SqlWorkbenchSettings, DEFAULT_SETTINGS } from "../settings";

import { ensureSqlMetaHeader } from "../meta/ensureSqlMetaHeader";
import { toggleSqlLineComment } from "../format/commentCommands";
import { toggleSqlBlockCommentLines  } from "../format/blockCommentCommands";
import { toLeadingCommas, toTrailingCommas } from "../format/selectListFormatter";
import { formatSqlAll } from "../format/formatPipeline";
import { renderMetaHeader, parseSqlMeta, SqlMeta } from "../meta/metaHeader";

export type SqlFormatLanguage = "tsql" | "sql" | "postgresql" | "mysql" | "sqlite" | "plsql";
export type SqlKeywordCase = "upper" | "lower" | "preserve";
export type SqlIndentStyle = "standard" | "tabularLeft" | "tabularRight";
export type SqlCommaPosition = "before" | "after";

export const VIEW_TYPE_SQL_WORKBENCH = "sql-workbench-view";

export function sqlGlobalHotkeys(): Extension {
  return ViewPlugin.fromClass(
    class {
      private view: EditorView;
      private handler: (e: KeyboardEvent) => void;

      constructor(view: EditorView) {
        this.view = view;

        this.handler = (e: KeyboardEvent) => {
          // SQL Viewer のエディタにフォーカスがある時だけ有効
          if (!this.view.hasFocus) return;

          const isMod = e.ctrlKey || e.metaKey;

          // 環境差があるので key/code どちらも見る（日本語配列対策も含む）
          const isSlash =
            e.key === "/" ||
            e.code === "Slash" ||
            e.key === "Divide" ||
            e.code === "IntlRo"; // 一部JISで出ることがある

          const isQuestion = e.key === "?" || (e.shiftKey && isSlash);

          // Ctrl+/（または Cmd+/）
          if (isMod && !e.shiftKey && isSlash) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation(); // ★Obsidian側を確実に止める
            toggleSqlLineComment(this.view);
            return;
          }

          // Ctrl+Shift+/（または Cmd+Shift+/）
          if (isMod && (isQuestion || (e.shiftKey && isSlash))) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            toggleSqlBlockCommentLines(this.view);
            return;
          }
        };

        // ★capture=true が重要（Obsidianのグローバルより先に取る）
        window.addEventListener("keydown", this.handler, true);
      }

      destroy() {
        window.removeEventListener("keydown", this.handler, true);
      }
    }
  );
}

export function sqlCommentKeymap(): Extension {
  return keymap.of([
    { key: "Mod-/", run: toggleSqlLineComment, preventDefault: true  },
    { key: "Mod-Shift-/", run: toggleSqlBlockCommentLines, preventDefault: true  },
  ]);
}

export class SqlWorkbenchView extends FileView {
  private fileText: string = "";
  private isEditMode: boolean = false;
  private dirty: boolean = false;
  private editorView: EditorView | null = null;
  private plugin: SqlWorkbenchPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: SqlWorkbenchPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SQL_WORKBENCH;
  }

  getDisplayText(): string {
    return "SQL Workbench";
  }

  canAcceptExtension(extension: string): boolean {
    return extension.toLowerCase() === "sql";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("sql-workbench");

    // 右上アクション
    this.addAction("save", "Save", async () => {
      await this.saveIfNeeded(true);
    });

    this.addAction("wand-2", "Format SQL", () => {
      this.formatCurrentSql();
    });

    this.addAction("pencil", "Toggle edit mode", async () => {
      await this.toggleEditMode();
    });


    this.contentEl.createEl("div", { text: "No SQL file loaded." });
  }

  async onLoadFile(file: TFile): Promise<void> {
    const raw = await this.app.vault.read(file);

    const { changed, text } = ensureSqlMetaHeader(raw);

    this.fileText = text;

    if (changed) {
      // dirty 扱いにする（自動保存はしない）
      this.dirty = true;
    }

    await this.render();
  }

  async setViewData(data: string, clear: boolean): Promise<void> {
    if (clear) this.fileText = "";
    this.fileText = data ?? "";
    await this.render();
  }

  getViewData(): string {
    return this.fileText;
  }

  clear(): void {
    this.fileText = "";
    this.dirty = false;
    this.contentEl.empty();

    if (this.editorView) {
      this.editorView.destroy();
      this.editorView = null;
    }
  }

  private async executeSql(sqlText: string): Promise<void> {
    const danger = this.getDangerLevel(sqlText);

    if (danger !== "low") {
      const ok = await this.confirmDanger(danger, sqlText);
      if (!ok) return; // ★ここで中断
    }

    const text = (sqlText ?? "").trim();
    if (!text) {
      new Notice("SQLが空です");
      return;
    }

    const t0 = Date.now();

    let profileName = "";

    try {
      profileName = this.resolveProfileName(this.getEditorText());

      const profileExists = this.plugin.settings.profiles.some(p => p.name === profileName);
      if (!profileExists) {
        await (this.plugin as any).showResult(this.leaf, {
          kind: "error",
          message: `Profile not found: "${profileName}". Check settings/profiles or -- profile:.`,
        });
        return;
      }

      const result: any = await (this.plugin as any).executeSql(text, profileName);
      const elapsedMs = Date.now() - t0;

      const rows: any[] = Array.isArray(result?.rows) ? result.rows : [];
      const columns: string[] = Array.isArray(result?.columns) ? result.columns : [];

      const limit = 500;
      const sliced = rows.slice(0, limit);

      await (this.plugin as any).showResult(this.leaf, {
        kind: "table",
        columns,
        rows: sliced,
        rowsAffected: result?.rowsAffected,
        elapsedMs,
        profile: profileName,
      });

      if (rows.length > limit) {
        new Notice(`表示は先頭 ${limit} 行のみです（全 ${rows.length} 行）`);
      }
    } catch (e: any) {
      await (this.plugin as any).showResult(this.leaf, {
        kind: "error",
        message: e?.message ?? String(e),
        profile: profileName,
      });
    }
  }

  private getDangerLevel(sqlText: string): "low" | "medium" | "high" {
    try {
      const meta = parseSqlMeta(sqlText);
      const d = (meta["danger"] ?? "").toLowerCase();
      if (d === "high" || d === "medium" || d === "low") return d;
    } catch {}
    return "medium"; // 未指定は安全側
  }

private async confirmDanger(danger: "low" | "medium" | "high", sql: string): Promise<boolean> {
  if (danger === "low") return true;

  return await new Promise<boolean>((resolve) => {
    const modal = new Modal(this.app);
    modal.titleEl.setText(`Danger: ${danger.toUpperCase()}`);

    modal.contentEl.createEl("div", {
      text:
        danger === "high"
          ? "This SQL is marked as HIGH danger. Execute anyway?"
          : "This SQL is not LOW danger. Execute anyway?",
    });

    const pre = modal.contentEl.createEl("pre");
    pre.setText(sql.slice(0, 4000)); // 長過ぎると重いので上限

    const buttons = modal.contentEl.createDiv({ cls: "sqlwb-confirm-buttons" });

    const btnRun = buttons.createEl("button", { text: "⚠️Run", cls: ["sqlwb-btn", "is-primary"] });
    const btnCancel = buttons.createEl("button", { text: "Cancel", cls: ["sqlwb-btn", "is-cancel"] });

    btnCancel.onclick = () => { modal.close(); resolve(false); };
    btnRun.onclick = () => { modal.close(); resolve(true); };

    // フォーカスはキャンセル優先
    setTimeout(() => btnCancel.focus(), 0);

    modal.open();
  });
}

  private resolveProfileName(sqlTextForMeta: string): string {
    const fromFile = this.getProfileOverrideFromText(sqlTextForMeta);
    const active = (this.plugin.settings.activeProfile ?? "").trim();

    const name = (fromFile ?? "").trim() || active;

    // profiles が空/activeProfile 未設定などの保険
    if (!name) {
      const first = this.plugin.settings.profiles?.[0]?.name;
      return first ?? "";
    }
    return name;
  }

  private getEditorText(): string {
    return this.editorView?.state.doc.toString() ?? this.fileText ?? "";
  }

  private getSqlToExecute(): string {
    const ev = this.editorView;
    if (!ev) return "";

    const sel = ev.state.selection.main;
    if (!sel.empty) {
      return ev.state.doc.sliceString(sel.from, sel.to);
    }

    const line = ev.state.doc.lineAt(sel.head);
    return line.text;
  }

  private async toggleEditMode(): Promise<void> {
    if (this.isEditMode) {
      // edit -> view
      await this.saveIfNeeded(false);

      if (this.editorView) {
        this.editorView.destroy();
        this.editorView = null;
      }

      this.isEditMode = false;
    } else {
      // view -> edit
      this.isEditMode = true;
    }

    await this.render();
  }

  private async saveIfNeeded(showNotice: boolean): Promise<void> {
    if (!this.file) return;

    const newText =
      this.editorView
        ? this.editorView.state.doc.toString()
        : this.fileText;

    if (!this.dirty && newText === this.fileText) return;

    await this.app.vault.modify(this.file, newText);

    this.fileText = newText;
    this.dirty = false;

    if (showNotice) {
      new Notice("Saved .sql");
    }
  }

  private formatCurrentSql(): void {
    if (!this.editorView) {
      new Notice("Edit mode only (open editor first).");
      return;
    }

    const view = this.editorView;
    if (!view) return;

    const ranges = view.state.selection.ranges;
    const hasSelection = ranges.some(r => !r.empty);
    const state = view.state;

    const fmt = this.plugin?.settings ?? DEFAULT_SETTINGS;

    const formatOne = (sqlText: string): string => {
      const indentStr = " ".repeat(fmt.format.indentSize ?? 2);

      let formatted = formatSql(sqlText, {
        language: fmt.format.formatLanguage,
        keywordCase: fmt.format.keywordCase,
        indentStyle: fmt.format.indentStyle,

        tabWidth: (fmt.format.indentSize ?? 2),
        useTabs: false,
      });

      if (fmt.format.commaPosition === "before") {
        formatted = toLeadingCommas(formatted);
      } else {
        formatted = toTrailingCommas(formatted);
      }

      formatted = formatSqlAll(formatted, {
          indentSize: fmt.format.indentSize,
      });

      return formatted;
    };

    try {
      if (!hasSelection) {
        const original = state.doc.toString();
        const formatted = formatOne(original);

        view.dispatch({
          changes: { from: 0, to: state.doc.length, insert: formatted },
          selection: EditorSelection.cursor(Math.min(state.selection.main.head, formatted.length)),
        });

        this.dirty = true;
        new Notice("Formatted (all)");
        return;
      }

      // 選択がある場合：後ろから順に置換（位置ズレ防止）
      const nonEmpty = ranges
        .filter((r) => !r.empty)
        .map((r) => ({ from: Math.min(r.from, r.to), to: Math.max(r.from, r.to) }))
        .sort((a, b) => b.from - a.from);

      const changes: { from: number; to: number; insert: string }[] = [];

      for (const r of nonEmpty) {
        const selected = state.doc.sliceString(r.from, r.to);
        const formatted = formatOne(selected);
        changes.push({ from: r.from, to: r.to, insert: formatted });
      }

      view.dispatch({ changes });

      this.dirty = true;
      new Notice(`Formatted (selection x${nonEmpty.length})`);
    } catch (e) {
      new Notice("Format failed: " + String(e));
    }
  }

  private async render(): Promise<void> {
    this.contentEl.empty();

    // メタ表示（既存の関数を利用）
    const meta = parseSqlMeta(this.fileText ?? "");
    renderMetaHeader(this.app, this.contentEl, meta);

    if (this.isEditMode) {
      const wrap = this.contentEl.createDiv({ cls: "sql-inline-editor-wrap" });

      const status = wrap.createDiv({ cls: "sql-inline-editor-status" });
      status.setText(this.dirty ? "● modified" : " ");

      const host = wrap.createDiv({ cls: "sql-inline-cm-host" });

      // 既存 editor があれば破棄
      if (this.editorView) {
        this.editorView.destroy();
        this.editorView = null;
      }

      const saveCommand = () => {
        this.saveIfNeeded(true).then(() => status.setText(" "));
        return true;
      };

      const indentSize = this.plugin?.settings?.format?.indentSize ?? DEFAULT_SETTINGS.format.indentSize;
      const indent = " ".repeat(indentSize);

      const execSelectionCommand = () => {
        const sql = this.getSqlToExecute();
        void this.executeSql(sql);
        return true;
      };

      const execAllCommand = () => {
        const sql = this.getEditorText();
        void this.executeSql(sql);
        return true;
      };

      const state = EditorState.create({
        doc: this.fileText ?? "",

        extensions: [
          sqlGlobalHotkeys(),
          keymap.of([indentWithTab]),
          Prec.highest(
            keymap.of([
              {
                key: "Mod-F5",
                run: () => {
                  const sql = this.getSqlToExecute();
                  void this.executeSql(sql);
                  return true;
                },
                preventDefault: true,
              },
              {
                key: "F5",
                run: () => {
                  const sql = this.getEditorText();
                  void this.executeMultiple(sql);
                  return true;
                },
                preventDefault: true,
              },
            ])
          ),
          indentOnInput(),
          indentUnit.of(indent),
          lineNumbers(),
          highlightActiveLineGutter(),
          sql(), // SQL シンタックス
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          sqlCommentKeymap(),
          keymap.of([
            ...defaultKeymap,
            { key: "Ctrl-s", run: saveCommand },
            { key: "Mod-s", run: saveCommand },
          ]),
          EditorView.updateListener.of((v) => {
            if (v.docChanged) {
              this.dirty = true;
              status.setText("● modified");
            }
          }),
          EditorView.lineWrapping,
        ],
      });

      this.editorView = new EditorView({
        state,
        parent: host,
      });

      this.editorView.focus();
      return;
    }

    // --- 表示モード（ハイライト）---
    const md = "```sql\n" + (this.fileText ?? "") + "\n```";
    const sourcePath = this.file?.path ?? "";
    const body = this.contentEl.createDiv({ cls: "sql-workbench__body" });

    await MarkdownRenderer.renderMarkdown(md, body, sourcePath, this);
  }

  public executeSelectionOrLine(): void {
    const sql = this.getSqlToExecute();
    void this.executeSql(sql);
  }

  public executeAll(): void {
    const sql = this.getEditorText();
    void this.executeMultiple(sql);
  }

  private async executeMultiple(sqlText: string): Promise<void> {
    const { splitSqlStatementsWithMeta } = await import("../sqlSplitWithMeta");
    const chunks = splitSqlStatementsWithMeta(sqlText);

    if (chunks.length === 0) {
      new Notice("SQLが空です");
      return;
    }

    // multi タブ枠（1件でも tabs 表示にしたくないなら、ここは条件分岐してOK）
    await (this.plugin as any).showResult(this.leaf, {
      kind: "multi",
      tabs: chunks.map((_, i) => ({ title: `SQL ${i + 1}`, state: "running" })),
    });

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      const stmt = (c.sql ?? "").trim();
      const t0 = Date.now();

      // danger：SQLごと
      const d = ((c.meta?.danger ?? "") as string).toLowerCase();
      const danger = (d === "low" || d === "medium" || d === "high") ? d : "medium";
      if (danger !== "low") {
        const ok = await this.confirmDanger(danger as any, stmt);
        if (!ok) {
          await (this.plugin as any).updateResultTab(this.leaf, {
            index: i,
            title: `SQL ${i + 1}`,
            sql: stmt,
            state: "error",
            payload: { kind: "error", message: "Canceled." },
          });
          continue;
        }
      }

      // profile：SQLごと
      const fromMeta = (c.meta?.profile ?? "").toString().trim();
      const profileName = fromMeta || (this.plugin.settings.activeProfile ?? "").trim();

      const profileExists = this.plugin.settings.profiles.some((p) => p.name === profileName);
      if (!profileExists) {
        await (this.plugin as any).updateResultTab(this.leaf, {
          index: i,
          title: `SQL ${i + 1}`,
          sql: stmt,
          state: "error",
          payload: { kind: "error", message: `Profile not found: "${profileName}"` },
        });
        continue;
      }

      try {
        const result: any = await (this.plugin as any).executeSql(stmt, profileName);
        const elapsedMs = Date.now() - t0;

        const rows: any[] = Array.isArray(result?.rows) ? result.rows : [];
        const columns: string[] = Array.isArray(result?.columns) ? result.columns : [];

        const limit = 500;
        const sliced = rows.slice(0, limit);

        await (this.plugin as any).updateResultTab(this.leaf, {
          index: i,
          title: `SQL ${i + 1}`,
          sql: stmt,
          profile: profileName,
          state: "ok",
          payload: {
            kind: "table",
            columns,
            rows: sliced,
            rowsAffected: result?.rowsAffected,
            elapsedMs,
            profile: profileName,
          },
        });

        if (rows.length > limit) {
          new Notice(`表示は先頭 ${limit} 行のみです（全 ${rows.length} 行）`);
        }
      } catch (e: any) {
        await (this.plugin as any).updateResultTab(this.leaf, {
          index: i,
          title: `SQL ${i + 1}`,
          sql: stmt,
          state: "error",
          payload: { kind: "error", message: e?.message ?? String(e) },
        });
      }
    }
  }


  private getProfileOverrideFromEditor(): string | undefined {
    const text = this.getEditorText();
    return this.getProfileOverrideFromText(text);
  }

  private getProfileOverrideFromText(text: string): string | undefined {
    // 先頭のコメントブロック（-- 連続）内だけを見る
    const lines = (text ?? "").split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();

      // 先頭コメントブロック終了条件：
      // 空行はスキップして、最初に "--" 以外が出たら終了
      if (trimmed === "") continue;
      if (!trimmed.startsWith("--")) break;

      // -- profile(任意): xxx
      // -- profile: xxx
      const m = trimmed.match(/^--\s*profile(?:\([^)]*\))?\s*:\s*(.*)$/i);
      if (m) {
        const name = (m[1] ?? "").trim();
        return name ? name : undefined;
      }
    }
    return undefined;
  }

}
