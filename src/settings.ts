import {
	App,
	PluginSettingTab,
	Setting,
	FuzzySuggestModal,
	TFile,
	TFolder,
} from "obsidian";
import ScoutPlugin from "./main";

class FilePickerModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private onChoose: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder("Type to search for files...");
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile) {
		this.onChoose(file);
	}
}

class FolderPickerModal extends FuzzySuggestModal<TFolder> {
	constructor(
		app: App,
		private onChoose: (folder: TFolder) => void,
	) {
		super(app);
		this.setPlaceholder("Type to search for folders...");
	}

	getItems(): TFolder[] {
		return this.app.vault
			.getAllLoadedFiles()
			.filter((f) => f instanceof TFolder) as TFolder[];
	}

	getItemText(folder: TFolder): string {
		return folder.path;
	}

	onChooseItem(folder: TFolder) {
		this.onChoose(folder);
	}
}

type PathSettingKey =
	| "movieTemplateFilePath"
	| "movieOutputLocation"
	| "tvShowTemplateFilePath"
	| "tvShowOutputLocation"
	| "bookTemplateFilePath"
	| "bookOutputLocation";

interface ScoutPluginSettings {
	enableTvFeatures: boolean;
	enableBookFeatures: boolean;
	tmdbAccessToken?: string;
	movieTemplateFilePath?: string;
	movieOutputLocation?: string;
	tvShowTemplateFilePath?: string;
	tvShowOutputLocation?: string;
	bookTemplateFilePath?: string;
	bookOutputLocation?: string;
	// Persist the last selected view mode in the search modal ("list" or "grid")
	lastViewMode?: "list" | "grid";
	lastBookViewMode?: "list" | "grid";
}

const DEFAULT_SETTINGS: ScoutPluginSettings = {
	enableTvFeatures: true,
	enableBookFeatures: true,
	movieTemplateFilePath: "",
	movieOutputLocation: "",
	tvShowTemplateFilePath: "",
	tvShowOutputLocation: "",
	bookTemplateFilePath: "",
	bookOutputLocation: "",
	lastViewMode: "list",
	lastBookViewMode: "list",
};

export class ScoutSettingTab extends PluginSettingTab {
	settings: ScoutSettings;

	constructor(app: App, plugin: ScoutPlugin) {
		super(app, plugin);
		this.settings = plugin.settings;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		let tvSettingsContainer: HTMLDivElement;
		let bookSettingsContainer: HTMLDivElement;

		new Setting(containerEl)
			.setName("Enable TV Features")
			.addToggle((toggle) =>
				toggle
					.setValue(this.settings.get("enableTvFeatures"))
					.onChange(async (value) => {
						await this.settings.set("enableTvFeatures", value);
						tvSettingsContainer.style.display = value
							? "block"
							: "none";
					}),
			);

		tvSettingsContainer = containerEl.createDiv();

		tvSettingsContainer.style.display = this.settings.get(
			"enableTvFeatures",
		)
			? "block"
			: "none";

		new Setting(tvSettingsContainer)
			.setName("TMDB Access Token")
			.setDesc("Create a free account on TMDB to get your Access Token.")
			.addText((text) =>
				text
					.setPlaceholder("Enter your Access Token")
					.setValue(this.settings.get("tmdbAccessToken") || "")
					.onChange((value) =>
						this.settings.set("tmdbAccessToken", value),
					),
			);

		this.addPathSetting(
			tvSettingsContainer,
			"Movie Template",
			"Path to the movie template file (relative to vault root)",
			"e.g., templates/movie-template.md",
			"movieTemplateFilePath",
			"file",
		);

		this.addPathSetting(
			tvSettingsContainer,
			"Movie Location",
			"Folder to create movie files in (relative to vault root)",
			"e.g., Movies",
			"movieOutputLocation",
			"folder",
		);

		this.addPathSetting(
			tvSettingsContainer,
			"TV Show Template",
			"Path to the TV show template file (relative to vault root)",
			"e.g., templates/tv-template.md",
			"tvShowTemplateFilePath",
			"file",
		);

		this.addPathSetting(
			tvSettingsContainer,
			"TV Show Location",
			"Folder to create TV show files in (relative to vault root)",
			"e.g., TV Shows",
			"tvShowOutputLocation",
			"folder",
		);

		new Setting(containerEl)
			.setName("Enable Book Features")
			.addToggle((toggle) =>
				toggle
					.setValue(this.settings.get("enableBookFeatures"))
					.onChange(async (value) => {
						await this.settings.set("enableBookFeatures", value);
						bookSettingsContainer.style.display = value
							? "block"
							: "none";
					}),
			);

		bookSettingsContainer = containerEl.createDiv();
		bookSettingsContainer.style.display = this.settings.get(
			"enableBookFeatures",
		)
			? "block"
			: "none";

		this.addPathSetting(
			bookSettingsContainer,
			"Book Template",
			"Path to the book template file (relative to vault root)",
			"e.g., templates/book-template.md",
			"bookTemplateFilePath",
			"file",
		);

		this.addPathSetting(
			bookSettingsContainer,
			"Book Location",
			"Folder to create book files in (relative to vault root)",
			"e.g., Books",
			"bookOutputLocation",
			"folder",
		);
	}

	private addPathSetting(
		container: HTMLElement,
		name: string,
		desc: string,
		placeholder: string,
		key: PathSettingKey,
		type: "file" | "folder",
	) {
		if (typeof this.settings.get(key) !== "string") {
			return;
		}

		let inputEl: HTMLInputElement;

		new Setting(container)
			.setName(name)
			.setDesc(desc)
			.addText((text) => {
				inputEl = text.inputEl;
				text.setPlaceholder(placeholder)
					.setValue(this.settings.get(key) as string)
					.onChange((value) => this.settings.set(key, value));
			})
			.addButton((btn) =>
				btn
					.setButtonText("Choose")
					.setCta()
					.onClick(() => {
						if (type === "file") {
							new FilePickerModal(this.app, (file) => {
								inputEl.value = file.path;
								inputEl.dispatchEvent(new Event("input"));
							}).open();
						} else {
							new FolderPickerModal(this.app, (folder) => {
								inputEl.value = folder.path;
								inputEl.dispatchEvent(new Event("input"));
							}).open();
						}
					}),
			);
	}
}

export class ScoutSettings {
	private app: App;
	private plugin: ScoutPlugin;
	private store: ScoutPluginSettings;

	constructor(app: App, plugin: ScoutPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	async init() {
		await this.load();
		this.createSettingTab();
	}

	async load() {
		this.store = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.plugin.loadData(),
		);
	}

	async saveSettings() {
		await this.plugin.saveData(this.store);
	}

	createSettingTab() {
		this.plugin.addSettingTab(new ScoutSettingTab(this.app, this.plugin));
	}

	get<K extends keyof ScoutPluginSettings>(key: K): ScoutPluginSettings[K] {
		return this.store[key];
	}

	set<K extends keyof ScoutPluginSettings>(
		key: K,
		value: ScoutPluginSettings[K],
	) {
		this.store[key] = value;
		return this.saveSettings();
	}
}
