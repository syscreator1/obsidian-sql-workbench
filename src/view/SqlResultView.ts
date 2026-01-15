import { ItemView, WorkspaceLeaf } from "obsidian";
import SqlWorkbenchPlugin from "../main";

export const VIEW_TYPE_SQL_RESULT = "sql-workbench-result";

type SinglePayload =
  | { kind: "table"; columns: string[]; rows: any[]; rowsAffected?: number[]; elapsedMs?: number; profile?: string }
  | { kind: "message"; message: string; profile?: string }
  | { kind: "error"; message: string; profile?: string };

type MultiInitPayload = {
  kind: "multi";
  tabs: { title: string; state: "running" | "done" }[];
};

type ResultPayload = SinglePayload | MultiInitPayload;

type TabStatus = "running" | "done" | "error";
type TabState = {
  title: string;
  state: TabStatus;
  sql?: string;
  profile?: string;
  meta?: { rows?: number; elapsedMs?: number };
  content: SinglePayload & { profile?: string };
};

export class SqlResultView extends ItemView {
  private last: ResultPayload | null = null;
  private onClosed?: () => void;

  private single: SinglePayload | null = null;

  private debugLines: string[] = [];

  private sqlDetailsOpenByTab = new Map<number, boolean>();

  private multi: {
    active: number;
    tabs: {
      title: string;
      state: "running" | "done" | "error";
      sql?: string;
      profile?: string;
      meta?: { rows?: number; elapsedMs?: number };
      content: SinglePayload;
    }[];
  } | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: SqlWorkbenchPlugin, onClosed?: ()=>void) {
    super(leaf);
    this.onClosed = onClosed;
  }

  appendDebug(line: string) {
    const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.mmm
    this.debugLines.push(`[${ts}] ${line}`);
    if (this.debugLines.length > 200) this.debugLines.shift(); // Cap size
    this.render(); // Reflect immediately
  }

  getViewType(): string {
    return VIEW_TYPE_SQL_RESULT;
  }

  getDisplayText(): string {
    return "SQL Result";
  }

  onClose(): Promise<void> {
    this.contentEl.empty();
    this.onClosed?.();
    return Promise.resolve();
  }

  setResult(payload: ResultPayload) {
    if (payload.kind === "multi") {
      this.multi = {
        active: 0,
        tabs: payload.tabs.map((t) => ({
          title: t.title,
          state: t.state,
          meta: undefined,
          content: { kind: "message", message: "Running..." },
        })),
      };
      this.single = null;
      this.render();
      return;
    }

    // Single result
    this.single = payload;
    this.multi = null;
    this.render();
  }

  updateTab(
    index: number,
    title: string,
    sql: string,
    content: SinglePayload,
    profile?: string
  ) {
    if (!this.multi) return;
    if (index < 0 || index >= this.multi.tabs.length) return;

    const prev = this.multi.tabs[index];
    if (!prev) return;

    const meta =
      content.kind === "table"
        ? { rows: content.rows.length, elapsedMs: content.elapsedMs }
        : undefined;

    const state: "running" | "done" | "error" =
      content.kind === "error" ? "error" : "done";

    this.multi.tabs[index] = {
      ...prev,
      title,
      sql,
      profile: profile ?? prev.profile,
      state,
      meta,
      content,
    };

    // On first execution, the first tab is often running.
    // Auto-switching is possible, but here we keep tab switching user-driven.

    this.render();
  }

  private render() {
    const el = this.contentEl;
    el.empty();

    if (this.multi) {
      this.renderMulti(el);
      return;
    }

    if (!this.single) {
      el.createDiv({ text: "No results yet." });
      return;
    }

    this.renderSingle(el, this.single);
  }

  private renderMulti(root: HTMLElement) {
    const multi = this.multi!;
    const tabBar = root.createDiv({ cls: "sqlwb-tabs" });

    if (multi.active < 0 || multi.active >= multi.tabs.length) {
      multi.active = 0;
    }

    multi.tabs.forEach((t, i) => {
      const btn = tabBar.createEl("button", {
        cls:
          "sqlwb-tab" +
          (i === multi.active ? " is-active" : "") +
          (t.state === "error" ? " is-error" : "") +
          (t.state === "running" ? " is-running" : ""),
      });

      btn.createSpan({ text: t.title });

      if (t.meta?.rows != null) btn.createSpan({ cls: "sqlwb-badge", text: `${t.meta.rows} rows` });
      if (t.meta?.elapsedMs != null) btn.createSpan({ cls: "sqlwb-badge", text: `${t.meta.elapsedMs} ms` });

      btn.onclick = () => {
        multi.active = i;
        this.render();
      };
    });

    const body = root.createDiv({ cls: "sqlwb-tab-body" });

    const active = multi.tabs[multi.active];
    if (!active) {
      body.createDiv({ text: "No tab." });
      return;
    }

    // ★ Display used profile (per tab)
    const usedProfile =
      (active.content as any)?.profile ?? (active as any)?.profile ?? "";

    if (usedProfile) {
      body.createDiv({
        cls: "sqlwb-result-profile",
        text: `Profile: ${usedProfile}`,
      });
    }

    if (active.sql) {
      const sqlBox = body.createEl("details", { cls: "sqlwb-sqlbox" });
      sqlBox.createEl("summary", { text: "SQL" });
      sqlBox.createEl("pre", { text: active.sql });

      // ★ Restore open/closed state per tab
      const open = this.sqlDetailsOpenByTab.get(multi.active) ?? false;
      sqlBox.open = open;

      // ★ Persist state when toggled
      sqlBox.addEventListener("toggle", () => {
        this.sqlDetailsOpenByTab.set(multi.active, sqlBox.open);
      });
    }

    const toolbar = body.createDiv({ cls: "sqlwb-toolbar" });

    const btnRun = toolbar.createEl("button", { text: "Re-run" });
    btnRun.onclick = async () => { await this.rerunActive(); };

    const btnCopy = toolbar.createEl("button", { text: "Copy SQL" });
    btnCopy.onclick = async () => {
      const tab = this.multi?.tabs[this.multi.active];
      if (tab?.sql) await navigator.clipboard.writeText(tab.sql);
    };

    const btnCsv = toolbar.createEl("button", { text: "Export CSV" });
    btnCsv.onclick = async () => { await this.exportActiveAsCsv(); };

    this.renderSingle(body, active.content);
  }

  private renderSingle(root: HTMLElement, payload: SinglePayload) {
    const header = root.createDiv({ cls: "sqlwb-result-header" });

    if (payload.kind === "table") {
      const info = [
        `Rows: ${payload.rows.length}`,
        payload.rowsAffected?.length ? `rowsAffected: ${payload.rowsAffected.join(", ")}` : "",
        payload.elapsedMs != null ? `elapsed: ${payload.elapsedMs} ms` : "",
      ]
        .filter(Boolean)
        .join("  |  ");
      header.createDiv({ text: info });

      this.renderTable(root, payload.columns, payload.rows);
      return;
    }

    if (payload.profile) {
      header.createEl("div", {
        cls: "sqlwb-result-profile",
        text: `Profile: ${payload.profile}`,
      });
    }

    if (payload.kind === "error") {
      header.createDiv({ text: "Error" });
      root.createDiv({ cls: "sqlwb-result-error", text: payload.message });
      return;
    }

    header.createDiv({ text: "Message" });
    root.createDiv({ text: payload.message });
  }

  private renderTable(root: HTMLElement, columns: string[], rows: any[]) {
    const wrap = root.createDiv({ cls: "sqlwb-result-table-wrap" });
    const table = wrap.createEl("table", { cls: "sqlwb-result-table" });

    const thead = table.createEl("thead");
    const trh = thead.createEl("tr");
    for (const c of columns) trh.createEl("th", { text: c });

    const tbody = table.createEl("tbody");
    for (const r of rows) {
      const tr = tbody.createEl("tr");
      for (const c of columns) {
        const v = (r as any)?.[c];
        tr.createEl("td", { text: this.formatCell(v) });
      }
    }
  }

  private formatCell(v: any): string {
    if (v === null) return "NULL";
    if (v === undefined) return "";

    // Date
    if (v instanceof Date) return v.toISOString();

    // Buffer / Uint8Array
    // (Binary types may be returned by mssql/tedious)
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) {
      // Truncate to avoid heavy rendering
      const hex = v.toString("hex");
      return hex.length > 64 ? `${hex.slice(0, 64)}…` : hex;
    }
    if (v instanceof Uint8Array) {
      const hex = Array.from(v)
        .slice(0, 32)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return v.length > 32 ? `${hex}…` : hex;
    }

    // Array
    if (Array.isArray(v)) {
      // Example: ["0","0"] -> want to show "0"?
      // Choose behavior as preferred.

      // A) If all elements are identical, show only one (["0","0"] => "0")
      const allSame =
        v.length > 0 && v.every((x) => String(x) === String(v[0]));
      if (allSame) return this.formatCell(v[0]);

      // B) Otherwise, comma-separated (["a","b"] => "a, b")
      return v.map((x) => this.formatCell(x)).join(", ");
    }

    // Plain object
    if (typeof v === "object") {
      // Handle common shapes first (extend as needed)
      // e.g., { value: ... } / { text: ... }
      if ("value" in v) return this.formatCell((v as any).value);
      if ("text" in v) return this.formatCell((v as any).text);

      // Fallback to JSON (truncate if long)
      try {
        const s = JSON.stringify(v);
        return s.length > 200 ? `${s.slice(0, 200)}…` : s;
      } catch {
        return String(v);
      }
    }

    // boolean / number / string
    return String(v);
  }

  private async rerunActive() {
    const multi = this.multi;
    if (!multi) return;

    const idx = multi.active;
    const tab = multi.tabs[idx];
    if (!tab?.sql) return;

    // Show running state
    tab.state = "running";
    tab.meta = undefined;
    tab.content = { kind: "message", message: "Running..." };
    this.render();

    const t0 = Date.now();
    try {
      const result: any = await (this.plugin as any).executeSql(tab.sql, tab.profile);
      const elapsedMs = Date.now() - t0;

      // Assumes DbClient(QueryResult)
      const rows: any[] = Array.isArray(result?.rows) ? result.rows : [];
      const columns: string[] = Array.isArray(result?.columns) ? result.columns : [];

      // rowsLimit (temporary)
      const limit = 500;

      this.updateTab(idx, tab.title, tab.sql, {
        kind: "table",
        columns,
        rows: rows.slice(0, limit),
        rowsAffected: result?.rowsAffected,
        elapsedMs,
      });
    } catch (e: any) {
      this.updateTab(idx, tab.title, tab.sql, {
        kind: "error",
        message: e?.message ?? String(e),
      });
    }
  }

  private async exportActiveAsCsv() {
    const multi = this.multi;
    if (!multi) return;

    const tab = multi.tabs[multi.active];
    if (!tab || tab.content.kind !== "table") return;

    const { columns, rows } = tab.content;

    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [
      columns.map(esc).join(","),
      ...rows.map((r) => columns.map((c) => esc((r as any)[c])).join(",")),
    ];
    const csv = lines.join("\r\n");

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `SQL-Result-${ts}.csv`;

    const file = await this.plugin.app.vault.create(filename, csv);
    await this.plugin.app.workspace.getLeaf(false).openFile(file);
  }

}
