import {
  App,
  FileView,
  ItemView,
  MarkdownRenderer,
  Plugin,
  TFile,
  WorkspaceLeaf,
  Modal,
  PluginSettingTab,
  Setting,
  Notice,
} from "obsidian";

import { parseSqlMeta, SqlMeta } from "../meta/metaHeader";
import { normalizeTags } from "../meta/tagUtils";
import SqlWorkbenchPlugin from "../main";
import { VIEW_TYPE_SQL_WORKBENCH } from "./SqlWorkbenchView";

export const VIEW_TYPE_SQL_WORKBENCH_WORKBENCH_SEARCH = "sql-workbench-search";

export type SearchMode = "AND" | "OR";

export class SqlWorkbenchSearchView extends ItemView {
  private currentTags: string[] = [];      // ← 複数対応
  private excludeTags: string[] = [];      // ← 除外対応
  private mode: SearchMode = "AND";        // ← 検索モード(AND/OR)
  private plugin: SqlWorkbenchPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: SqlWorkbenchPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SQL_WORKBENCH_WORKBENCH_SEARCH;
  }

  getDisplayText(): string {
    return "SQL Workbench Search";
  }

  getIcon(): string {
    return "search";
  }

  /** 通常クリック：リセット */
  async setSingleTag(tag: string) {
    const t = (tag ?? "").trim().toLowerCase();
    this.currentTags = t ? [t] : [];
    this.mode = "AND";
    await this.render();
  }

  /** Ctrl/Shift：追加、Alt：削除 */
  async updateTags(tag: string, mode: SearchMode, action: "add" | "remove") {
    const t = (tag ?? "").trim().toLowerCase();
    if (!t) return;

    if (action === "remove") {
      this.currentTags = this.currentTags.filter((x) => x !== t);
      await this.render();
      return;
    }

    // add
    this.mode = mode;
    if (!this.currentTags.includes(t)) this.currentTags.push(t);
    await this.render();
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("sql-search-view");
    await this.render();
  }

  async render() {
    const { contentEl } = this;
    contentEl.empty();

    // --- ヘッダ ---
    const header = contentEl.createDiv({ cls: "sql-search-view__header" });

    header.createEl("div", {
      cls: "sql-search-view__title",
      text:
        this.currentTags.length > 0
          ? `SQL Search (${this.mode})`
          : "SQL Search",
    });

    // ① 入力欄 + モード + ボタン
    const controls = header.createDiv({ cls: "sql-search-view__controls" });

    // 入力欄（カンマ区切り）
    const input = controls.createEl("input", {
      type: "text",
      cls: "sql-search-view__input",
      attr: {
        placeholder: "tags (comma separated) 例: aras, migration",
        value: [
          ...this.currentTags,
          ...this.excludeTags.map((t) => `-${t}`),
        ].join(", "),
      },
    });

    // AND/OR セレクト
    const modeSel = controls.createEl("select", {
      cls: "sql-search-view__mode",
    });
    modeSel.createEl("option", { text: "AND", value: "AND" });
    modeSel.createEl("option", { text: "OR", value: "OR" });
    modeSel.value = this.mode;

    // 適用ボタン
    const btnApply = controls.createEl("button", {
      cls: "sql-search-view__btn",
      text: "Apply",
    });

    // クリアボタン
    const btnClear = controls.createEl("button", {
      cls: "sql-search-view__btn",
      text: "Clear",
    });

    // 入力を currentTags/mode に反映して再描画
    const applyFromUi = async () => {
      const raw = input.value ?? "";

      const tokens = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const includes: string[] = [];
      const excludes: string[] = [];

      for (const tok of tokens) {
        if (tok.startsWith("-")) {
          const t = tok.slice(1).trim().toLowerCase();
          if (t) excludes.push(t);
        } else {
          const t = tok.toLowerCase();
          if (t) includes.push(t);
        }
      }

      // 重複排除
      this.currentTags = Array.from(new Set(includes));
      this.excludeTags = Array.from(new Set(excludes));

      this.mode = (modeSel.value === "OR" ? "OR" : "AND") as SearchMode;

      await this.render();
    };

    btnApply.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await applyFromUi();
    });

    btnClear.addEventListener("click", async (ev) => {
      ev.preventDefault();
      this.currentTags = [];
      this.excludeTags = [];
      this.mode = "AND";
      await this.render();
    });

    // Enter で適用
    input.addEventListener("keydown", async (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        await applyFromUi();
      }
    });

    // ② 条件チップ（既存機能：クリックで除外）
    if (this.currentTags.length > 0) {
      const chips = header.createDiv({ cls: "sql-search-view__chips" });

      // include
      for (const t of this.currentTags) {
        const chip = chips.createSpan({ cls: "sql-search-view__chip", text: t });
        chip.setAttr("title", "クリックで除外（条件から削除）");
        chip.addEventListener("click", async () => {
          this.currentTags = this.currentTags.filter((x) => x !== t);
          await this.render();
        });
      }

      // exclude
      for (const t of this.excludeTags) {
        const chip = chips.createSpan({ cls: "sql-search-view__chip is-exclude", text: `-${t}` });
        chip.setAttr("title", "クリックで除外条件から削除");
        chip.addEventListener("click", async () => {
          this.excludeTags = this.excludeTags.filter((x) => x !== t);
          await this.render();
        });
      }
    } else {
      contentEl.createEl("div", { text: "Click a tag or type tags to search .sql files." });
      return;
    }


    // --- 結果一覧 ---
    const list = contentEl.createDiv({ cls: "sql-search-list" });

    const files = this.app.vault.getFiles().filter(
      (f) => f.extension.toLowerCase() === "sql"
    );

    let hitCount = 0;

    for (const file of files) {
      const text = await this.app.vault.cachedRead(file);
      const meta = parseSqlMeta(text);
      const fileTags = meta["tags"] ? normalizeTags(meta["tags"]) : [];

      // 除外タグが1つでも含まれていたら即除外
      if (this.excludeTags.length > 0 && this.excludeTags.some((t) => fileTags.includes(t))) {
        continue;
      }

      let matched = true;

      if (this.currentTags.length > 0) {
        matched =
          this.mode === "AND"
            ? this.currentTags.every((t) => fileTags.includes(t))
            : this.currentTags.some((t) => fileTags.includes(t));
      } else {
        // include無し＝「除外だけ」で絞り込む（全部表示）
        matched = true;
      }

      if (!matched) continue;

      hitCount++;
      this.renderItem(list, file, meta);
    }

    if (hitCount === 0) {
      list.createEl("div", { text: "No matching SQL files." });
    }
  }

  private renderItem(container: HTMLElement, file: TFile, meta: SqlMeta) {
    const row = container.createDiv({ cls: "sql-search-item" });

    const title = row.createDiv({ cls: "sql-search-title", text: file.path });
    title.addEventListener("click", () => {
      const leaf = this.app.workspace.getLeaf(true);
      leaf.openFile(file, { state: { mode: VIEW_TYPE_SQL_WORKBENCH } as any });
    });

    const metaLine = row.createDiv({ cls: "sql-search-meta" });
    if (meta["tags"]) metaLine.createSpan({ text: `tags: ${meta["tags"]}` });
    if (meta["danger"]) metaLine.createSpan({ text: ` | danger: ${meta["danger"]}` });
    if (meta["note"]) metaLine.createSpan({ text: ` | note: ${meta["note"]}` });
  }
}

export class SqlWorkbenchSearchModal extends Modal {
  private readonly tag: string;

  constructor(app: App, tag: string) {
    super(app);
    this.tag = tag.toLowerCase();
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `SQL Search: ${this.tag}` });

    const list = contentEl.createDiv({ cls: "sql-search-list" });

    const files = this.app.vault.getFiles().filter(
      (f) => f.extension.toLowerCase() === "sql"
    );

    for (const file of files) {
      const text = await this.app.vault.cachedRead(file);
      const meta = parseSqlMeta(text);

      const tags = meta["tags"] ? normalizeTags(meta["tags"]) : [];

      if (!tags.includes(this.tag)) continue;

      this.renderResult(list, file, meta);
    }

    if (!list.hasChildNodes()) {
      list.createEl("div", { text: "No matching SQL files." });
    }
  }

  private renderResult(container: HTMLElement, file: TFile, meta: SqlMeta) {
    const row = container.createDiv({ cls: "sql-search-item" });

    const title = row.createDiv({ cls: "sql-search-title", text: file.path });
    title.addEventListener("click", () => {
      this.close();
      const leaf = this.app.workspace.getLeaf(true);
      leaf.openFile(file, { state: { mode: VIEW_TYPE_SQL_WORKBENCH } as any });
    });

    const metaLine = row.createDiv({ cls: "sql-search-meta" });

    if (meta["tags"]) {
      metaLine.createSpan({ text: `tags: ${meta["tags"]}` });
    }
    if (meta["danger"]) {
      metaLine.createSpan({ text: ` | danger: ${meta["danger"]}` });
    }
    if (meta["note"]) {
      metaLine.createSpan({ text: ` | note: ${meta["note"]}` });
    }
  }
}
