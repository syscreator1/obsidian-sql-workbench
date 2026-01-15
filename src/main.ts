import { Plugin, WorkspaceLeaf, App, Menu, TAbstractFile, TFile, TFolder, Notice } from "obsidian";
import { SqlWorkbenchSettingTab, SqlWorkbenchSettings, DEFAULT_SETTINGS } from "./settings";

import type { DbClient } from "./db/DbClient";
import type { DbProfile } from "./settings";
import { createClient } from "./db/createClient";

import { SqlResultView, VIEW_TYPE_SQL_RESULT } from "./view/SqlResultView";

import {
  SqlWorkbenchView,
  VIEW_TYPE_SQL_WORKBENCH,
} from "./view/SqlWorkbenchView";

import {
  SqlWorkbenchSearchView,
  VIEW_TYPE_SQL_WORKBENCH_WORKBENCH_SEARCH,
  SearchMode,
} from "./view/SqlWorkbenchSearchView";

export default class SqlWorkbenchPlugin extends Plugin {
  settings: SqlWorkbenchSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new SqlWorkbenchSettingTab(this.app, this));

    this.registerView(VIEW_TYPE_SQL_WORKBENCH, (leaf) => new SqlWorkbenchView(leaf, this));
    this.registerView(VIEW_TYPE_SQL_WORKBENCH_WORKBENCH_SEARCH, (leaf) => new SqlWorkbenchSearchView(leaf, this));
    this.registerView(VIEW_TYPE_SQL_RESULT, (leaf) => new SqlResultView(leaf, this, () => {
        // Invalidate cache when the Result tab is closed
        if (this.resultLeaf === leaf) this.resultLeaf = null;
      })
    );

    this.registerExtensions(["sql"], VIEW_TYPE_SQL_WORKBENCH);

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TFile) => {
        menu.addSeparator();
        menu.addItem((item) => {
          item
            .setTitle("New SQL file")
            .setIcon("file-plus")
            .onClick(async () => {
              const folder = this.toFolder(file);
              await this.createNewSqlFile(folder);
            });
        });
      })
    );

    this.addCommand({
      id: "open-current-sql-in-sql-workbench",
      name: "Open current SQL file in SQL Workbench",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension.toLowerCase() !== "sql") return;

        const leaf = this.app.workspace.getLeaf(true);
        leaf.openFile(file, {
          active: true,
          state: { mode: VIEW_TYPE_SQL_WORKBENCH } as any,
        });
      },
    });

    this.addCommand({
      id: "sql-workbench-execute-selection-or-line",
      name: "SQL Workbench: Execute selection / current line",
      checkCallback: (checking) => {
        const view = this.getAnySqlWorkbenchView();
        if (!view) return false;
        if (!checking) view.executeSelectionOrLine();
        return true;
      },
    });

    this.addCommand({
      id: "sql-workbench-execute-all",
      name: "SQL Workbench: Execute all",
      checkCallback: (checking) => {
        const view = this.getAnySqlWorkbenchView();
        if (!view) return false;
        if (!checking) view.executeAll();
        return true;
      },
    });

  }

  private clientCache = new Map<string, DbClient>();

  private async getOrCreateClient(profile: DbProfile): Promise<DbClient> {
    const key = profile.name;
    const existing = this.clientCache.get(key);
    if (existing) return existing;

    const client = await createClient(profile); // switch(profile.type)
    this.clientCache.set(key, client);
    return client;
  }

  async executeSql(sqlText: string, profileName?: string) {
    const profile = profileName
      ? this.getProfileByName(profileName)
      : this.getActiveProfile();

    if (profile.readonly) {
      const firstToken = this.getFirstSqlToken(sqlText);
      if (!["select", "with"].includes(firstToken)) {
        throw new Error("Read-only mode: SELECT/WITH only");
      }
    }

    const client = await this.getOrCreateClient(profile);
    return await client.query(sqlText);
  }

  private getProfileByName(name: string): DbProfile {
    const p = this.settings.profiles.find((x) => x.name === name);
    if (!p) throw new Error(`Profile not found: ${name}`);
    return p;
  }

  async showResult(sourceLeaf: WorkspaceLeaf, payload: any) {
    const leaf = await this.ensureResultLeaf(sourceLeaf);
    const view = leaf.view as SqlResultView;
    view.setResult(payload);
  }

  async debug(sourceLeaf: WorkspaceLeaf, msg: string) {
    const leaf = await this.ensureResultLeaf(sourceLeaf);
    const view = leaf.view as SqlResultView;
    view.appendDebug(msg);
  }

  private resultLeaf: WorkspaceLeaf | null = null;

  private async ensureResultLeaf(sourceLeaf: WorkspaceLeaf): Promise<WorkspaceLeaf> {
    // Reuse if already allocated and still valid
    if (this.resultLeaf) {
      // Invalidate if the view is no longer a Result view
      if (this.resultLeaf.view?.getViewType?.() === VIEW_TYPE_SQL_RESULT) {
        return this.resultLeaf;
      }
      this.resultLeaf = null;
    }

    // Reuse an existing Result leaf if one already exists
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SQL_RESULT);
    const existing = leaves.find((l): l is WorkspaceLeaf => l !== undefined);
    if (existing) {
      this.resultLeaf = existing;
      return existing;
    }

    // Split vertically (horizontal split = top/bottom) based on sourceLeaf
    const ws: any = this.app.workspace as any;
    const resultLeaf: WorkspaceLeaf =
      ws.createLeafBySplit?.(sourceLeaf, "horizontal")
      ?? this.app.workspace.getLeaf("split", "horizontal");

    await resultLeaf.setViewState({ type: VIEW_TYPE_SQL_RESULT, active: false });
    this.resultLeaf = resultLeaf;
    return resultLeaf;
  }

  private getAnySqlWorkbenchView(): SqlWorkbenchView | null {
    // Pick an active SqlWorkbenchView leaf
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SQL_WORKBENCH); // viewType for SqlWorkbenchView
    const leaf = leaves.find((l): l is WorkspaceLeaf => l !== undefined) ?? null;
    if (!leaf) return null;

    return leaf.view instanceof SqlWorkbenchView ? leaf.view : (leaf.view as any as SqlWorkbenchView);
  }

  private getActiveProfile(): DbProfile {
    const name = this.settings.activeProfile;
    const p = this.settings.profiles.find(x => x.name === name);
    if (!p) throw new Error(`Active profile not found: ${name}`);
    return p;
  }

  async updateResultTab(
    sourceLeaf: WorkspaceLeaf,
    args: {
      index: number;
      title: string;
      sql: string;
      payload: any;
      profile?: string;
    }
  ) {
    const leaf = await this.ensureResultLeaf(sourceLeaf);
    const view = leaf.view as SqlResultView;
    view.updateTab(
      args.index,
      args.title,
      args.sql,
      args.payload,
      args.profile
    );
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_SQL_WORKBENCH);
    this.clientCache.clear();
  }

  public async testConnection(profile: DbProfile): Promise<{ ok: boolean; message: string; elapsedMs: number }> {
    const t0 = Date.now();
    try {
      // Do not use cache for testing; create and close the client immediately (safe)
      const client = await createClient(profile);
      try {
        // Use a lightweight SQL per DB (SELECT 1 is sufficient)
        await client.query("SELECT 1 AS ok");
      } finally {
        await client.close();
      }
      return { ok: true, message: "Connection OK", elapsedMs: Date.now() - t0 };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e), elapsedMs: Date.now() - t0 };
    }
  }

  public async resetDbClients(profileName?: string): Promise<void> {
    const map = this.clientCache; // The actual cache in use

    const targets: DbClient[] = [];
    for (const [name, client] of map.entries()) {
      if (!profileName || name === profileName) {
        targets.push(client);
        map.delete(name);
      }
    }

    await Promise.allSettled(
      targets.map(async (c) => {
        try {
          await c.close?.();
        } catch {}
      })
    );
  }

  async openSqlWorkbenchSearchSidebar(
    tag: string,
    opts?: { mode?: SearchMode; action?: "add" | "remove" | "set" }
  ) {
    const mode: SearchMode = opts?.mode ?? "AND";
    const action = opts?.action ?? "set";

    // Expand the right sidebar
    try {
      const ws: any = this.app.workspace as any;
      ws.rightSplit?.expand?.();
      ws.rightSplit?.collapsed && ws.rightSplit?.toggle?.();
    } catch {}

    let leaf: WorkspaceLeaf | null =
      this.app.workspace.getLeavesOfType(VIEW_TYPE_SQL_WORKBENCH_WORKBENCH_SEARCH)[0] ?? null;

    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(true);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE_SQL_WORKBENCH_WORKBENCH_SEARCH, active: true });
    } else {
      await leaf.setViewState({ type: VIEW_TYPE_SQL_WORKBENCH_WORKBENCH_SEARCH, active: true });
    }

    try {
      this.app.workspace.revealLeaf(leaf);
    } catch {}

    const view = leaf.view;
    const v: any = view;

    if (view instanceof SqlWorkbenchSearchView) {
      if (action === "set") await view.setSingleTag(tag);
      else await view.updateTags(tag, mode, action);
      return;
    }

    // any fallback
    if (action === "set") await v?.setSingleTag?.(tag);
    else await v?.updateTags?.(tag, mode, action);
  }

  private getFirstSqlToken(sqlText: string): string {
    const lines = (sqlText ?? "").split(/\r?\n/);

    // Skip leading comments/blank lines and find the first SQL-like line
    for (let i = 0; i < lines.length; i++) {
      let line = (lines[i] ?? "").trim();
      if (!line) continue;

      // Line comment
      if (line.startsWith("--")) continue;

      // Block comment start (simple version: skip until */)
      if (line.startsWith("/*")) {
        while (i < lines.length && !(lines[i] ?? "").includes("*/")) i++;
        continue;
      }

      // This is the first actual SQL line
      // Strip leading parentheses or semicolons
      line = line.replace(/^[\s;()]+/, "");
      const token = (line.split(/\s+/)[0] ?? "").toLowerCase();
      return token;
    }

    return "";
  }

  private toFolder(target: TAbstractFile | null): TFolder {
    if (target instanceof TFolder) return target;
    if (target instanceof TFile) return target.parent ?? this.app.vault.getRoot();
    return this.app.vault.getRoot();
  }

  private async createNewSqlFile(folder: TFolder) {
    try {
      const baseName = "new-query";
      const ext = "sql";

      const path = await this.getUniquePath(folder, baseName, ext);

      const initial = [
        "-- tags: ",
        "-- owner: ",
        "-- danger: low",
        "-- note: ",
        "",
        "SELECT",
        "  1 AS demo",
        ";",
        "",
      ].join("\n");

      const file = await this.app.vault.create(path, initial);

      // Open the file after creation (activate it)
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.openFile(file, { active: true });

      new Notice(`Created: ${file.path}`);
    } catch (e) {
      console.error(e);
      new Notice(`Failed to create SQL file: ${String(e)}`);
    }
  }

  private async getUniquePath(folder: TFolder, baseName: string, ext: string): Promise<string> {
    const norm = (n: number) => (n === 0 ? "" : `-${n}`);
    for (let i = 0; i < 1000; i++) {
      const name = `${baseName}${norm(i)}.${ext}`;
      const path = folder.path ? `${folder.path}/${name}` : name; // root support
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (!existing) return path;
    }
    throw new Error("Could not find unique filename.");
  }

  refreshOpenSqlEditors() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SQL_WORKBENCH);
    for (const leaf of leaves) {
      const view = leaf.view as any;
      // SqlWorkbenchView.render() regenerates indentation from settings,
      // so a re-render is sufficient to apply changes
      if (typeof view?.render === "function") {
        view.render();
      }
    }
  }
}

export async function openSearchWithQuery(app: App, query: string) {
  // Force-expand the right sidebar (internal API, so use any)
  try {
    const ws: any = app.workspace as any;
    ws.rightSplit?.expand?.();
    ws.rightSplit?.collapsed && ws.rightSplit?.toggle?.();
  } catch {
    // ignore
  }

  // Look for an existing search leaf
  let leaf: WorkspaceLeaf | null =
    app.workspace.getLeavesOfType("search")[0] ?? null;

  // If none exists, create one in the right sidebar
  if (!leaf) {
    const rightLeaf = app.workspace.getRightLeaf(true);
    if (!rightLeaf) return; // null guard (important)

    await rightLeaf.setViewState({
      type: "search",
      active: true,
    });

    leaf = rightLeaf;
  } else {
    // Activate existing leaf
    await leaf.setViewState({
      type: "search",
      active: true,
    });
  }

  // Ensure visibility and focus
  try {
    app.workspace.revealLeaf(leaf);
    app.workspace.setActiveLeaf(leaf, { focus: true } as any);
  } catch {
    // ignore
  }

  // Wait for view initialization
  await new Promise((r) => setTimeout(r, 50));

  const view: any = leaf.view;

  // Set query via API if available
  if (typeof view?.setQuery === "function") {
    view.setQuery(query);
    if (typeof view?.onQueryChanged === "function") {
      view.onQueryChanged();
    }
    return;
  }

  // Fallback (DOM-based)
  try {
    const input: HTMLInputElement | null =
      leaf.view.containerEl.querySelector('input[type="search"]') ??
      leaf.view.containerEl.querySelector("input");

    if (input) {
      input.focus();
      input.value = query;
      input.dispatchEvent(new Event("input"));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    }
  } catch {
    // ignore
  }
}
