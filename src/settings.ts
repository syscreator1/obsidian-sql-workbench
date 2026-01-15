import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import SqlWorkbenchPlugin from "./main";

export type DbType = "sqlserver" | "postgres";

// Added: types used within settings.ts (define here if they don't exist elsewhere)
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
      .setDesc("Number of spaces per indent level (2 or 4 recommended)")
      .addText((t) => {
        t.setPlaceholder("2")
          .setValue(String(this.plugin.settings.format.indentSize ?? 2))
          .onChange(async (v) => {
            const n = Number(v);
            const size =
              Number.isFinite(n) ? Math.min(8, Math.max(1, Math.floor(n))) : 2;

            this.plugin.settings.format.indentSize = size;
            await this.plugin.saveSettings();

            // Apply if an editor view is open
            this.plugin.refreshOpenSqlEditors();
          });
      });

    // --- Formatter language ---
    new Setting(containerEl)
      .setName("Formatter language")
      .setDesc("Dialect for sql-formatter (use tsql for SQL Server)")
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
      .setDesc("Keyword casing (upper/lower)")
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
      .setDesc("Indentation style")
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
      .setDesc("Leading comma (before) / trailing comma (after)")
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
        .setDesc("No profiles yet. Add profiles in settings.ts (DEFAULT_SETTINGS).");
    } else {
      new Setting(containerEl)
        .setName("Active DB profile")
        .setDesc("Select the connection profile used for SQL execution")
        .addDropdown((dd) => {
          const profiles = this.plugin.settings.profiles ?? [];

          // options
          for (const p of profiles) {
            dd.addOption(p.name, `${p.name} (${p.type})`);
          }

          // current (fall back to the first entry if missing)
          const current =
            profiles.find((p) => p.name === this.plugin.settings.activeProfile)?.name ??
            profiles[0]?.name ??
            "";

          dd.setValue(current);

          dd.onChange(async (v) => {
            this.plugin.settings.activeProfile = v;
            await this.plugin.saveSettings();

            // Optional: if you have a connection cache, dispose and recreate it
            (this.plugin as any).resetDbClients?.();
          });
        });
    }

    new Setting(containerEl)
      .setName("Add profile")
      .setDesc("Add a new connection profile")
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

    // One editor UI per profile
    const profiles = this.plugin.settings.profiles ?? [];
    profiles.forEach((p, i) => {
      this.renderProfileEditor(containerEl, p, i);
    });

  }

  private renderProfileEditor(containerEl: HTMLElement, p: DbProfile, index: number) {
    // Heading
    const headerEl = containerEl.createEl("h4", { text: `${p.name} (${p.type})` });

    // Name
    new Setting(containerEl)
      .setName("Name")
      .setDesc("Profile name (must be unique)")
      .addText((t) => {
        t.setValue(p.name);

        // Previous name (used to keep activeProfile in sync and decide what to reset)
        let prevName = p.name;

        // Highlight the input in red when duplicated (lightweight feedback)
        const setDupState = (isDup: boolean) => {
          t.inputEl.toggleClass("is-invalid", isDup);
          t.inputEl.setAttr("aria-invalid", isDup ? "true" : "false");
        };

        const isDupName = (name: string) =>
          this.plugin.settings.profiles.some((x, idx) => idx !== index && x.name === name);

        // While typing: update the model + header only (no full re-render)
        t.onChange((v) => {
          const next = (v ?? "").trim();
          if (!next) {
            setDupState(false);
            return;
          }

          const dup = isDupName(next);
          setDupState(dup);
          if (dup) return;

          // Keep activeProfile in sync if it points to this profile (no re-render)
          if (this.plugin.settings.activeProfile === prevName) {
            this.plugin.settings.activeProfile = next;
          }

          p.name = next;
          headerEl.setText(`${p.name} (${p.type})`);
        });

        // On commit (blur): save + re-render if needed
        t.inputEl.addEventListener("blur", async () => {
          const next = (t.getValue?.() ?? t.inputEl.value ?? "").trim();
          if (!next) return;

          const dup = isDupName(next);
          setDupState(dup);
          if (dup) return;

          // Save + reset connections only here
          await this.saveAndReset();

          // Profile name is likely used as a Map key, so a full reset is safer
          // (partial reset may leave stale keys behind)
          await this.plugin.resetDbClients();

          // Re-render only when you want to sync headings/dropdowns, etc. (blur avoids focus issues)
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

          // Optionally adjust the default port when switching types
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
      .setDesc("Settings are stored in plain text in data.json")
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
        .setDesc("If you hit SSL/TLS errors on SQL Server 2012, turning this off is recommended")
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

          // If the activeProfile was deleted, fall back to the first profile
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
  activeProfile: string;     // name or id
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

  // New: profiles
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
  name: string;          // Display name
  type: DbType;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  readonly: boolean;
  trustServerCertificate?: boolean;
  encrypt?: boolean;

  // Type-specific options are optional for now
  options?: Record<string, any>;
}
