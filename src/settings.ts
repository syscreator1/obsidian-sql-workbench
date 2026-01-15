import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import SqlWorkbenchPlugin from "./main";

export type DbType = "sqlserver" | "postgres";

// ★ここを追加：settings.ts 内で使う型（他ファイルに無いならここで定義）
type SqlFormatLanguage = "tsql" | "sql" | "postgresql" | "mysql" | "sqlite" | "plsql";
type SqlKeywordCase = "upper" | "lower" | "preserve";
type SqlIndentStyle = "standard" | "tabularLeft" | "tabularRight";
type SqlCommaPosition = "after" | "before";

export class SqlWorkbenchSettingTab extends PluginSettingTab {
  plugin: SqlWorkbenchPlugin;

  constructor(app: App, plugin: SqlWorkbenchPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "SQL Workbench" });

    // --- Indent size ---
    new Setting(containerEl)
      .setName("Indent size")
      .setDesc("1段のスペース数（2 or 4 推奨）")
      .addText((t) => {
        t.setPlaceholder("2")
          .setValue(String(this.plugin.settings.format.indentSize ?? 2))
          .onChange(async (v) => {
            const n = Number(v);
            const size =
              Number.isFinite(n) ? Math.min(8, Math.max(1, Math.floor(n))) : 2;

            this.plugin.settings.format.indentSize = size;
            await this.plugin.saveSettings();

            // 編集ビューが開いていれば反映
            this.plugin.refreshOpenSqlEditors();
          });
      });

    // --- Formatter language ---
    new Setting(containerEl)
      .setName("Formatter language")
      .setDesc("sql-formatter の方言指定（SQL Serverなら tsql）")
      .addDropdown((dd) => {
        const langs: SqlFormatLanguage[] = [
          "tsql",
          "sql",
          "postgresql",
          "mysql",
          "sqlite",
          "plsql",
        ];
        langs.forEach((x) => dd.addOption(x, x));
        dd.setValue(this.plugin.settings.format.formatLanguage);
        dd.onChange(async (v) => {
          this.plugin.settings.format.formatLanguage = v as SqlFormatLanguage;
          await this.plugin.saveSettings();
        });
      });

    // --- Keyword case ---
    new Setting(containerEl)
      .setName("Keyword case")
      .setDesc("キーワードの大文字/小文字")
      .addDropdown((dd) => {
        const cases: SqlKeywordCase[] = ["upper", "lower", "preserve"];
        cases.forEach((x) => dd.addOption(x, x));
        dd.setValue(this.plugin.settings.format.keywordCase);
        dd.onChange(async (v) => {
          this.plugin.settings.format.keywordCase = v as SqlKeywordCase;
          await this.plugin.saveSettings();
        });
      });

    // --- Indent style ---
    new Setting(containerEl)
      .setName("Indent style")
      .setDesc("インデントスタイル")
      .addDropdown((dd) => {
        const styles: SqlIndentStyle[] = [
          "standard",
          "tabularLeft",
          "tabularRight",
        ];
        styles.forEach((x) => dd.addOption(x, x));
        dd.setValue(this.plugin.settings.format.indentStyle);
        dd.onChange(async (v) => {
          this.plugin.settings.format.indentStyle = v as SqlIndentStyle;
          await this.plugin.saveSettings();
        });
      });

    // --- Comma position ---
    new Setting(containerEl)
      .setName("Comma position")
      .setDesc("前カンマ（before）/ 後カンマ（after）")
      .addDropdown((dd) => {
        dd.addOption("after", "after (trailing comma)");
        dd.addOption("before", "before (leading comma)");
        dd.setValue(this.plugin.settings.format.commaPosition);
        dd.onChange(async (v) => {
          this.plugin.settings.format.commaPosition = v as SqlCommaPosition;
          await this.plugin.saveSettings();
        });
      });

    // --- Profiles (CRUD) ---
    containerEl.createEl("h3", { text: "DB Profiles" });

    // --- Active DB profile ---
    if (!this.plugin.settings.profiles?.length) {
      new Setting(containerEl)
        .setName("DB profiles")
        .setDesc("プロファイルがまだありません。settings.ts の DEFAULT_SETTINGS に profiles を追加してください。");
    } else {
      new Setting(containerEl)
        .setName("Active DB profile")
        .setDesc("SQL実行に使う接続プロファイルを選択します")
        .addDropdown((dd) => {
          const profiles = this.plugin.settings.profiles ?? [];

          // options
          for (const p of profiles) {
            dd.addOption(p.name, `${p.name} (${p.type})`);
          }

          // current (存在しない場合は先頭に寄せる)
          const current =
            profiles.find((p) => p.name === this.plugin.settings.activeProfile)?.name ??
            profiles[0]?.name ??
            "";

          dd.setValue(current);

          dd.onChange(async (v) => {
            this.plugin.settings.activeProfile = v;
            await this.plugin.saveSettings();

            // ★任意：接続キャッシュを持っているなら破棄して張り直す
            (this.plugin as any).resetDbClients?.();
          });
        });
    }

    new Setting(containerEl)
      .setName("Add profile")
      .setDesc("新しい接続プロファイルを追加します")
      .addButton((b) =>
        b.setButtonText("Add").onClick(async () => {
          const next = this.makeNewProfile();
          this.plugin.settings.profiles.push(next);

          if (!this.plugin.settings.activeProfile) {
            this.plugin.settings.activeProfile = next.name;
          }

          await this.plugin.resetDbClients?.();
          await this.plugin.saveSettings();
          this.display();
        })
      );

    // 1件ずつ編集UI
    const profiles = this.plugin.settings.profiles ?? [];
    profiles.forEach((p, i) => {
      this.renderProfileEditor(containerEl, p, i);
    });


  }

  private renderProfileEditor(containerEl: HTMLElement, p: DbProfile, index: number) {
    // 見出し
    const headerEl = containerEl.createEl("h4", { text: `${p.name} (${p.type})` });


    // Name
    new Setting(containerEl)
      .setName("Name")
      .setDesc("プロファイル名（重複不可）")
      .addText((t) => {
        t.setValue(p.name);

        // 以前の名前（activeProfile追従・reset対象判定に使う）
        let prevName = p.name;

        // 重複時に入力欄を赤くする（軽いフィードバック）
        const setDupState = (isDup: boolean) => {
          t.inputEl.toggleClass("is-invalid", isDup);
          t.inputEl.setAttr("aria-invalid", isDup ? "true" : "false");
        };

        const isDupName = (name: string) =>
          this.plugin.settings.profiles.some((x, idx) => idx !== index && x.name === name);

        // 入力中：モデル更新＋ヘッダ更新のみ（再描画しない）
        t.onChange((v) => {
          const next = (v ?? "").trim();
          if (!next) {
            setDupState(false);
            return;
          }

          const dup = isDupName(next);
          setDupState(dup);
          if (dup) return;

          // activeProfile がこのプロファイルなら追従（ただし表示再描画はしない）
          if (this.plugin.settings.activeProfile === prevName) {
            this.plugin.settings.activeProfile = next;
          }

          p.name = next;
          headerEl.setText(`${p.name} (${p.type})`);
        });

        // 確定（フォーカスアウト）時：保存＋必要なら再描画
        t.inputEl.addEventListener("blur", async () => {
          const next = (t.getValue?.() ?? t.inputEl.value ?? "").trim();
          if (!next) return;

          const dup = isDupName(next);
          setDupState(dup);
          if (dup) return;

          // ここで初めて保存・接続リセット
          await this.saveAndReset();

          // プロファイル名は Map キーに使っている可能性が高いので安全に全リセット推奨
          // （部分リセットだと旧キーが残る可能性がある）
          await this.plugin.resetDbClients();

          // 見出しやドロップダウンなどを整合させたい場合だけ再描画（blurなのでフォーカス問題なし）
          this.display();

          prevName = next;
        });
      });

    // Type
    new Setting(containerEl)
      .setName("Type")
      .addDropdown((dd) => {
        (["sqlserver", "postgres"] as DbType[]).forEach((x) =>
          dd.addOption(x, x)
        );
        dd.setValue(p.type);
        dd.onChange(async (v) => {
          p.type = v as DbType;

          // typeを変えたときに port のデフォルトを寄せる（任意）
          if (p.type === "postgres" && (!p.port || p.port === 1433)) p.port = 5432;
          if (p.type === "sqlserver" && (!p.port || p.port === 5432)) p.port = 1433;
          //if (p.type === "mysql" && (!p.port || p.port === 5432 || p.port === 1433)) p.port = 3306;

          await this.saveAndReset();
          this.display();
        });
      });

    new Setting(containerEl).setName("Host").addText((t) => {
      t.setValue(p.host ?? "");
      t.onChange(async (v) => {
        p.host = v;
        await this.saveAndReset();
      });
    });

    new Setting(containerEl).setName("Port").addText((t) => {
      t.setValue(String(p.port ?? ""));
      t.onChange(async (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return;
        p.port = n;
        await this.saveAndReset();
      });
    });

    new Setting(containerEl).setName("Database").addText((t) => {
      t.setValue(p.database ?? "");
      t.onChange(async (v) => {
        p.database = v;
        await this.saveAndReset();
      });
    });

    new Setting(containerEl).setName("User").addText((t) => {
      t.setValue(p.user ?? "");
      t.onChange(async (v) => {
        p.user = v;
        await this.saveAndReset();
      });
    });

    new Setting(containerEl)
      .setName("Password")
      .setDesc("設定は data.json に平文で保存されます")
      .addText((t) => {
        t.setValue(p.password ?? "");
        (t.inputEl as HTMLInputElement).type = "password";
        t.onChange(async (v) => {
          p.password = v;
          await this.saveAndReset();
        });
      });

    new Setting(containerEl).setName("Read-only").addToggle((tg) => {
      tg.setValue(!!p.readonly);
      tg.onChange(async (v) => {
        p.readonly = v;
        await this.saveAndReset();
      });
    });

    // SQL Server only
    if (p.type === "sqlserver") {
      new Setting(containerEl)
        .setName("Trust server certificate")
        .addToggle((tg) => {
          tg.setValue(!!p.trustServerCertificate);
          tg.onChange(async (v) => {
            p.trustServerCertificate = v;
            await this.saveAndReset();
          });
        });

      new Setting(containerEl)
        .setName("Encrypt")
        .setDesc("SQL Server 2012などでSSL/TLSエラーになる場合はOFF推奨")
        .addToggle((tg) => {
          tg.setValue(!!p.options?.encrypt);
          tg.onChange(async (v) => {
            p.options = p.options ?? {};
            p.options.encrypt = v;
            await this.saveAndReset();

            await this.plugin.resetDbClients(p.name);
          });
        });

    }

    // Buttons row
    new Setting(containerEl)
      .setName("Actions")
      .addButton((b) =>
        b.setButtonText("Test").onClick(async () => {
          const res = await this.plugin.testConnection(p);
          const msg = res.ok
            ? `${p.name}: OK (${res.elapsedMs}ms)`
            : `${p.name}: NG (${res.elapsedMs}ms) - ${res.message}`;
          new Notice(msg);
        })
      )

      .addButton((b) =>
        b.setButtonText("Duplicate").onClick(async () => {
          const copy: DbProfile = {
            ...p,
            name: this.makeUniqueName(`${p.name}-copy`),
          };
          this.plugin.settings.profiles.push(copy);
          await this.saveAndReset();
          this.display();
        })
      )
      .addButton((b) =>
        b.setButtonText("Delete").setCta().onClick(async () => {
          this.plugin.settings.profiles.splice(index, 1);

          // activeProfile が消えたら先頭へ
          if (this.plugin.settings.activeProfile === p.name) {
            this.plugin.settings.activeProfile =
              this.plugin.settings.profiles[0]?.name ?? "";
          }

          await this.saveAndReset();
          this.display();
        })
      );

    containerEl.createEl("hr");
  }

  private makeNewProfile(): DbProfile {
    const name = this.makeUniqueName("new-profile");
    return {
      name,
      type: "postgres",
      host: "127.0.0.1",
      port: 5432,
      database: "postgres",
      user: "postgres",
      password: "",
      readonly: true,
      options: {},
    };
  }

  private makeUniqueName(base: string): string {
    const names = new Set((this.plugin.settings.profiles ?? []).map((x) => x.name));
    if (!names.has(base)) return base;

    for (let i = 2; i < 9999; i++) {
      const n = `${base}-${i}`;
      if (!names.has(n)) return n;
    }
    return `${base}-${Date.now()}`;
  }

  private async saveAndReset() {
    await this.plugin.resetDbClients?.();
    await this.plugin.saveSettings();
  }

}

export interface SqlWorkbenchSettings {
  format: {
    indentSize: number;
    formatLanguage: SqlFormatLanguage;
    keywordCase: SqlKeywordCase;
    indentStyle: SqlIndentStyle;
    commaPosition: SqlCommaPosition;
  };
  activeProfile: string;     // name か id
  profiles: {
    name: string;
    type: "sqlserver" | "postgres";
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    readonly: boolean;
    trustServerCertificate?: boolean;
    encrypt?: boolean;
  }[];
}

export const DEFAULT_SETTINGS: SqlWorkbenchSettings = {
  format: {
    indentSize: 2,
    formatLanguage: "tsql",
    keywordCase: "upper",
    indentStyle: "standard",
    commaPosition: "before",
  },

  // 新：profiles
  activeProfile: "pg-dev",
  profiles: [
    {
      name: "default",
      type: "postgres",
      host: "172.17.125.1",
      port: 5432,
      database: "upj_system_backup",
      user: "upj",
      password: "marutoku",
      readonly: true,
    },
    {
      name: "sqlserver",
      type: "sqlserver",
      host: "172.17.125.32",
      port: 1433,
      database: "_DevFront26",
      user: "sa",
      password: "",
      readonly: true,
    },
    {
      name: "pg-dev",
      type: "postgres",
      host: "172.17.125.1",
      port: 5432,
      database: "upj_system_backup",
      user: "upj",
      password: "marutoku",
      readonly: true,
    },
  ],
};

export interface DbProfile {
  name: string;          // 表示名
  type: DbType;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  readonly: boolean;
  trustServerCertificate?: boolean;
  encrypt?: boolean;

  // type別追加オプションは一旦 optional
  options?: Record<string, any>;
}
