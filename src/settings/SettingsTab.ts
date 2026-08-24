import {
  Plugin,
  PluginSettingTab,
  Setting,
  type App,
  type SettingDefinitionItem,
} from "obsidian";
import type { DossierSettings } from "../types";
import type { DailyNoteDatePreview } from "../dailyDates/DailyNoteDisplayService";

export interface SettingsHost {
  settings: DossierSettings;
  saveSettingsAndRefresh(): Promise<void>;
  getDailyNoteDatePreview(): DailyNoteDatePreview;
}

export class DossierSettingTab extends PluginSettingTab {
  private readonly host: SettingsHost;
  private settingsContainerEl: HTMLElement;

  constructor(app: App, host: Plugin & SettingsHost) {
    super(app, host);
    this.host = host;
    this.settingsContainerEl = this.containerEl;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      name: "Tradecraft settings",
      desc: "Contextual backlinks, readable Daily Notes, navigation, and timeline behavior.",
      aliases: SETTING_SEARCH_ALIASES,
      render: (setting) => {
        setting.settingEl.empty();
        setting.settingEl.addClass("tradecraft-settings-definition");
        this.renderSettings(setting.settingEl);
      },
    }];
  }

  display(): void {
    this.renderSettings(this.containerEl);
  }

  private renderSettings(containerEl: HTMLElement): void {
    this.settingsContainerEl = containerEl;
    containerEl.empty();
    const settings = this.host.settings;

    new Setting(containerEl).setName("Display").setHeading();
    this.toggle("Show contextual backlinks", settings.enabled, (value) => (settings.enabled = value));
    this.toggle("Show heading", settings.showHeading, (value) => (settings.showHeading = value));
    new Setting(containerEl)
      .setName("Heading")
      .addText((text) => text.setValue(settings.heading).onChange(async (value) => {
        settings.heading = value;
        await this.host.saveSettingsAndRefresh();
      }));
    this.toggle("Show reference count", settings.showCount, (value) => (settings.showCount = value));
    this.toggle("Show source heading", settings.showSourceHeading, (value) => (settings.showSourceHeading = value));
    this.toggle("Group by source note", settings.groupBySource, (value) => (settings.groupBySource = value));
    this.toggle("Show empty section", settings.showEmpty, (value) => (settings.showEmpty = value));

    new Setting(containerEl).setName("Daily note display").setHeading();
    this.toggle("Use readable daily note dates", settings.dailyNoteDates.enabled, (value) => {
      this.host.settings.dailyNoteDates.enabled = value;
    });
    new Setting(containerEl)
      .setName("Daily notes folder")
      .setDesc("Matches this case-sensitive vault folder and its descendants. Leave blank or use / for the vault root.")
      .addText((text) => text
        .setPlaceholder("Daily")
        .setValue(settings.dailyNoteDates.folder)
        .onChange(async (value) => {
          this.host.settings.dailyNoteDates.folder = value;
          await this.host.saveSettingsAndRefresh();
        }));
    const previewSetting = new Setting(containerEl).setName("Preview");
    const refreshPreview = () => this.renderDailyNotePreview(previewSetting);
    new Setting(containerEl)
      .setName("Filename date format")
      .setDesc("Moment-style format used to strictly parse the complete filename.")
      .addMomentFormat((format) => format
        .setDefaultFormat("YYYY-MM-DD")
        .setValue(settings.dailyNoteDates.filenameFormat)
        .onChange(async (value) => {
          this.host.settings.dailyNoteDates.filenameFormat = value;
          await this.host.saveSettingsAndRefresh();
          refreshPreview();
        }));
    new Setting(containerEl)
      .setName("Readable date format")
      .setDesc("Moment-style format shown in the File Explorer, tabs, and linked references.")
      .addMomentFormat((format) => format
        .setDefaultFormat("MMMM D, YYYY")
        .setValue(settings.dailyNoteDates.displayFormat)
        .onChange(async (value) => {
          this.host.settings.dailyNoteDates.displayFormat = value;
          await this.host.saveSettingsAndRefresh();
          refreshPreview();
        }));
    new Setting(containerEl)
      .setName("Inline title date format")
      .setDesc("Moment-style format used for the title shown inside an open Daily Note.")
      .addMomentFormat((format) => format
        .setDefaultFormat("ddd, MMMM Do, YYYY")
        .setValue(settings.dailyNoteDates.titleFormat)
        .onChange(async (value) => {
          this.host.settings.dailyNoteDates.titleFormat = value;
          await this.host.saveSettingsAndRefresh();
          refreshPreview();
        }));
    refreshPreview();
    this.toggle("Format dates in File Explorer", settings.dailyNoteDates.surfaces.fileExplorer, (value) => {
      this.host.settings.dailyNoteDates.surfaces.fileExplorer = value;
    });
    this.toggle("Format the inline note title", settings.dailyNoteDates.surfaces.inlineTitle, (value) => {
      this.host.settings.dailyNoteDates.surfaces.inlineTitle = value;
    });
    this.toggle("Format tab titles", settings.dailyNoteDates.surfaces.tabTitle, (value) => {
      this.host.settings.dailyNoteDates.surfaces.tabTitle = value;
    });
    this.toggle("Format linked-reference labels", settings.dailyNoteDates.surfaces.backlinks, (value) => {
      this.host.settings.dailyNoteDates.surfaces.backlinks = value;
    });

    new Setting(containerEl).setName("Weekly Daily Note navigator").setHeading();
    this.toggle("Show weekly navigator", settings.dailyNoteDates.navigator.enabled, (value) => {
      this.host.settings.dailyNoteDates.navigator.enabled = value;
    });
    this.toggle("Keep navigator visible while scrolling", settings.dailyNoteDates.navigator.sticky, (value) => {
      this.host.settings.dailyNoteDates.navigator.sticky = value;
    });
    new Setting(containerEl)
      .setName("Week starts on")
      .addDropdown((dropdown) => dropdown
        .addOption("monday", "Monday")
        .addOption("sunday", "Sunday")
        .setValue(settings.dailyNoteDates.navigator.weekStart)
        .onChange(async (value) => {
          if (value !== "monday" && value !== "sunday") return;
          this.host.settings.dailyNoteDates.navigator.weekStart = value;
          await this.host.saveSettingsAndRefresh();
        }));
    this.toggle("Show month header", settings.dailyNoteDates.navigator.showMonthHeader, (value) => {
      this.host.settings.dailyNoteDates.navigator.showMonthHeader = value;
    });
    this.toggle("Show today indicator", settings.dailyNoteDates.navigator.showTodayIndicator, (value) => {
      this.host.settings.dailyNoteDates.navigator.showTodayIndicator = value;
    });
    this.toggle(
      "Show indicators for existing notes",
      settings.dailyNoteDates.navigator.showExistingNoteIndicators,
      (value) => {
        this.host.settings.dailyNoteDates.navigator.showExistingNoteIndicators = value;
      },
    );
    new Setting(containerEl)
      .setName("When a date has no note")
      .setDesc("Daily Notes templates are used when its folder and filename format match Tradecraft.")
      .addDropdown((dropdown) => dropdown
        .addOption("daily-notes", "Create/open using Daily Notes")
        .addOption("blank", "Create a blank note")
        .addOption("nothing", "Do nothing")
        .setValue(settings.dailyNoteDates.navigator.missingNoteBehavior)
        .onChange(async (value) => {
          if (value !== "daily-notes" && value !== "blank" && value !== "nothing") return;
          this.host.settings.dailyNoteDates.navigator.missingNoteBehavior = value;
          await this.host.saveSettingsAndRefresh();
        }));
    new Setting(containerEl)
      .setName("Swipe animation")
      .addDropdown((dropdown) => dropdown
        .addOption("subtle", "Subtle")
        .addOption("none", "None")
        .setValue(settings.dailyNoteDates.navigator.animation)
        .onChange(async (value) => {
          if (value !== "subtle" && value !== "none") return;
          this.host.settings.dailyNoteDates.navigator.animation = value;
          await this.host.saveSettingsAndRefresh();
        }));

    new Setting(containerEl).setName("Desktop Daily Timeline").setHeading();
    this.toggle("Enable Daily Timeline", settings.dailyNoteDates.timeline.enabled, (value) => {
      this.host.settings.dailyNoteDates.timeline.enabled = value;
    });
    new Setting(containerEl)
      .setName("Open Daily Timeline on startup")
      .setDesc("On desktop, focus an existing Daily Timeline tab or open one after the workspace loads.")
      .addToggle((toggle) => toggle
        .setValue(settings.dailyNoteDates.timeline.openOnStartup)
        .onChange(async (value) => {
          this.host.settings.dailyNoteDates.timeline.openOnStartup = value;
          await this.host.saveSettingsAndRefresh();
        }));
    new Setting(containerEl)
      .setName("Loaded date window")
      .setDesc("Maximum number of nearby Daily Notes retained in the timeline at once.")
      .addDropdown((dropdown) => dropdown
        .addOption("21", "3 weeks")
        .addOption("35", "5 weeks")
        .addOption("49", "7 weeks")
        .addOption("63", "9 weeks")
        .setValue(String(settings.dailyNoteDates.timeline.windowDays))
        .onChange(async (value) => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed)) return;
          this.host.settings.dailyNoteDates.timeline.windowDays = parsed;
          await this.host.saveSettingsAndRefresh();
        }));

    new Setting(containerEl).setName("Context").setHeading();
    new Setting(containerEl)
      .setName("Context size")
      .addDropdown((dropdown) => dropdown
        .addOption("compact", "Compact")
        .addOption("normal", "Normal")
        .addOption("expanded", "Expanded")
        .setValue(settings.contextMode)
        .onChange(async (value) => {
          if (value !== "compact" && value !== "normal" && value !== "expanded") return;
          settings.contextMode = value;
          await this.host.saveSettingsAndRefresh();
          this.refreshSettings();
        }));
    this.toggle("Show advanced context settings", settings.showAdvancedSettings, (value) => {
      settings.showAdvancedSettings = value;
      queueMicrotask(() => this.refreshSettings());
    });
    if (settings.showAdvancedSettings) {
      const profile = settings.contextProfiles[settings.contextMode];
      this.number(
        `Neighbor blocks (${capitalize(settings.contextMode)})`,
        profile.neighborBlocks,
        0,
        10,
        (value) => (profile.neighborBlocks = value),
      );
      this.number(
        `Maximum excerpt length (${capitalize(settings.contextMode)})`,
        profile.maxChars,
        100,
        10000,
        (value) => (profile.maxChars = value),
      );
    }

    new Setting(containerEl).setName("Sorting").setHeading();
    new Setting(containerEl)
      .setName("Sort references")
      .addDropdown((dropdown) => dropdown
        .addOption("newest", "Newest first")
        .addOption("oldest", "Oldest first")
        .addOption("source", "Source title")
        .setValue(settings.sortOrder)
        .onChange(async (value) => {
          if (value !== "newest" && value !== "oldest" && value !== "source") return;
          settings.sortOrder = value;
          await this.host.saveSettingsAndRefresh();
        }));
    this.toggle("Parse dates from filenames", settings.parseFilenameDates, (value) => {
      settings.parseFilenameDates = value;
    });
    new Setting(containerEl)
      .setName("Filename date formats")
      .setDesc("One Moment-style format per line. Supported tokens: YYYY, MM, DD, dddd.")
      .addTextArea((text) => text
        .setValue(settings.dateFormats.join("\n"))
        .onChange(async (value) => {
          settings.dateFormats = value.split(/\r?\n/).map((format) => format.trim()).filter(Boolean);
          await this.host.saveSettingsAndRefresh();
        }));
    new Setting(containerEl)
      .setName("Date property")
      .setDesc("Frontmatter property used when a filename does not contain a date.")
      .addText((text) => text.setValue(settings.dateProperty).onChange(async (value) => {
        settings.dateProperty = value.trim();
        await this.host.saveSettingsAndRefresh();
      }));

    new Setting(containerEl).setName("Behavior").setHeading();
    this.number("Initial references shown", settings.initialReferenceLimit, 1, 500, (value) => {
      settings.initialReferenceLimit = value;
    });
    this.toggle("Include embeds", settings.includeEmbeds, (value) => (settings.includeEmbeds = value));
    this.toggle("Open source on excerpt click", settings.openSourceOnExcerptClick, (value) => {
      settings.openSourceOnExcerptClick = value;
    });

    new Setting(containerEl).setName("Exclusions").setHeading();
    this.prefixList("Excluded source folders", settings.sourceFolderExclusions, (value) => {
      settings.sourceFolderExclusions = value;
    });
    this.prefixList("Excluded target folders", settings.targetFolderExclusions, (value) => {
      settings.targetFolderExclusions = value;
    });

    new Setting(containerEl).setName("Developer").setHeading();
    this.toggle("Enable debug logging", settings.debug, (value) => (settings.debug = value));
  }

  private toggle(name: string, value: boolean, update: (value: boolean) => void): void {
    new Setting(this.settingsContainerEl).setName(name).addToggle((toggle) => toggle.setValue(value).onChange(async (next) => {
      update(next);
      await this.host.saveSettingsAndRefresh();
    }));
  }

  private number(
    name: string,
    value: number,
    min: number,
    max: number,
    update: (value: number) => void,
  ): void {
    new Setting(this.settingsContainerEl).setName(name).addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = String(min);
      text.inputEl.max = String(max);
      text.setValue(String(value)).onChange(async (raw) => {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return;
        update(Math.max(min, Math.min(max, Math.round(parsed))));
        await this.host.saveSettingsAndRefresh();
      });
    });
  }

  private prefixList(name: string, value: string[], update: (value: string[]) => void): void {
    new Setting(this.settingsContainerEl)
      .setName(name)
      .setDesc("One case-sensitive vault folder prefix per line.")
      .addTextArea((text) => text.setValue(value.join("\n")).onChange(async (raw) => {
        update(raw
          .split(/\r?\n/)
          .map((prefix) => prefix.trim().replace(/^\/+|\/+$/g, ""))
          .filter(Boolean));
        await this.host.saveSettingsAndRefresh();
      }));
  }

  private renderDailyNotePreview(setting: Setting): void {
    const preview = this.host.getDailyNoteDatePreview();
    setting.setDesc(preview.valid
      ? `${preview.source} → ${preview.display ?? ""}; title: ${preview.title ?? ""}`
      : preview.error ?? "Invalid date format.");
    setting.descEl.classList.toggle("dossier-setting-error", !preview.valid);
  }

  private refreshSettings(): void {
    this.renderSettings(this.settingsContainerEl);
  }
}

const SETTING_SEARCH_ALIASES = [
  "Show contextual backlinks",
  "Show heading",
  "Heading",
  "Show reference count",
  "Show source heading",
  "Group by source note",
  "Show empty section",
  "Use readable daily note dates",
  "Daily notes folder",
  "Filename date format",
  "Readable date format",
  "Inline title date format",
  "Format dates in File Explorer",
  "Format the inline note title",
  "Format tab titles",
  "Format linked-reference labels",
  "Show weekly navigator",
  "Keep navigator visible while scrolling",
  "Week starts on",
  "Show month header",
  "Show today indicator",
  "Show indicators for existing notes",
  "When a date has no note",
  "Swipe animation",
  "Enable Daily Timeline",
  "Open Daily Timeline on startup",
  "Loaded date window",
  "Context size",
  "Show advanced context settings",
  "Neighbor blocks",
  "Maximum excerpt length",
  "Sort references",
  "Parse dates from filenames",
  "Filename date formats",
  "Date property",
  "Initial references shown",
  "Include embeds",
  "Open source on excerpt click",
  "Excluded source folders",
  "Excluded target folders",
  "Enable debug logging",
];

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
