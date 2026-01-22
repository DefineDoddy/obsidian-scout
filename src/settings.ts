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

interface ScoutPluginSettings {
	tvFeatures: boolean;
	tmdbAccessToken?: string;
	movieTemplateFilePath?: string;
	movieOutputLocation?: string;
	tvTemplateFilePath?: string;
	tvOutputLocation?: string;
}

const DEFAULT_SETTINGS: ScoutPluginSettings = {
	tvFeatures: true,
	movieTemplateFilePath: "",
	movieOutputLocation: "",
	tvTemplateFilePath: "",
	tvOutputLocation: "",
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

		new Setting(containerEl)
			.setName("Enable TV Features")
			.addToggle((toggle) =>
				toggle
					.setValue(this.settings.get("tvFeatures"))
					.onChange(async (value) => {
						await this.settings.set("tvFeatures", value);
						tvSettingsContainer.style.display = value
							? "block"
							: "none";
					}),
			);

		tvSettingsContainer = containerEl.createDiv();

		tvSettingsContainer.style.display = this.settings.get("tvFeatures")
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
			"tvTemplateFilePath",
			"file",
		);

		this.addPathSetting(
			tvSettingsContainer,
			"TV Show Location",
			"Folder to create TV show files in (relative to vault root)",
			"e.g., TV Shows",
			"tvOutputLocation",
			"folder",
		);
	}

	private addPathSetting(
		container: HTMLElement,
		name: string,
		desc: string,
		placeholder: string,
		key:
			| "movieTemplateFilePath"
			| "movieOutputLocation"
			| "tvTemplateFilePath"
			| "tvOutputLocation",
		type: "file" | "folder",
	) {
		let inputEl: HTMLInputElement;
		new Setting(container)
			.setName(name)
			.setDesc(desc)
			.addText((text) => {
				inputEl = text.inputEl;
				text.setPlaceholder(placeholder)
					.setValue(this.settings.get(key) || "")
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
