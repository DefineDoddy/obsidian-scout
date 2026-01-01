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

		new Setting(containerEl)
			.setName("Enable TV Features")
			.addToggle((toggle) =>
				toggle
					.setValue(this.settings.get("tvFeatures"))
					.onChange(async (value) => {
						this.settings.set("tvFeatures", value);
						this.display();
					}),
			);

		if (this.settings.get("tvFeatures")) {
			new Setting(containerEl)
				.setName("TMDB Access Token")
				.setDesc(
					"Create a free account on TMDB to get your Access Token.",
				)
				.addText((text) =>
					text
						.setPlaceholder("Enter your Access Token")
						.setValue(this.settings.get("tmdbAccessToken") || "")
						.onChange(async (value) => {
							this.settings.set("tmdbAccessToken", value);
							await this.settings.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("Movie Template File Path")
				.setDesc(
					"Path to the movie template file (relative to vault root)",
				)
				.addText((text) => {
					text.setPlaceholder("e.g., templates/movie-template.md")
						.setValue(
							this.settings.get("movieTemplateFilePath") || "",
						)
						.onChange(async (value) => {
							this.settings.set("movieTemplateFilePath", value);
							await this.settings.saveSettings();
						});
					return text;
				})
				.addButton((btn) =>
					btn
						.setButtonText("Choose")
						.setCta()
						.onClick(() => {
							new FilePickerModal(this.app, (file) => {
								const textEls =
									containerEl.querySelectorAll(
										'input[type="text"]',
									);
								const textEl = textEls[1] as HTMLInputElement; // Second input
								if (textEl) {
									textEl.value = file.path;
									textEl.dispatchEvent(new Event("input"));
								}
							}).open();
						}),
				);

			new Setting(containerEl)
				.setName("Movie Output Location")
				.setDesc(
					"Folder to create movie files in (relative to vault root)",
				)
				.addText((text) => {
					text.setPlaceholder("e.g., Movies")
						.setValue(
							this.settings.get("movieOutputLocation") || "",
						)
						.onChange(async (value) => {
							this.settings.set("movieOutputLocation", value);
							await this.settings.saveSettings();
						});
					return text;
				})
				.addButton((btn) =>
					btn
						.setButtonText("Choose")
						.setCta()
						.onClick(() => {
							new FolderPickerModal(this.app, (folder) => {
								const textEls =
									containerEl.querySelectorAll(
										'input[type="text"]',
									);
								const textEl = textEls[2] as HTMLInputElement; // Third input
								if (textEl) {
									textEl.value = folder.path;
									textEl.dispatchEvent(new Event("input"));
								}
							}).open();
						}),
				);

			new Setting(containerEl)
				.setName("TV Template File Path")
				.setDesc(
					"Path to the TV show template file (relative to vault root)",
				)
				.addText((text) => {
					text.setPlaceholder("e.g., templates/tv-template.md")
						.setValue(this.settings.get("tvTemplateFilePath") || "")
						.onChange(async (value) => {
							this.settings.set("tvTemplateFilePath", value);
							await this.settings.saveSettings();
						});
					return text;
				})
				.addButton((btn) =>
					btn
						.setButtonText("Choose")
						.setCta()
						.onClick(() => {
							new FilePickerModal(this.app, (file) => {
								const textEls =
									containerEl.querySelectorAll(
										'input[type="text"]',
									);
								const textEl = textEls[3] as HTMLInputElement; // Fourth input
								if (textEl) {
									textEl.value = file.path;
									textEl.dispatchEvent(new Event("input"));
								}
							}).open();
						}),
				);

			new Setting(containerEl)
				.setName("TV Output Location")
				.setDesc(
					"Folder to create TV show files in (relative to vault root)",
				)
				.addText((text) => {
					text.setPlaceholder("e.g., TV Shows")
						.setValue(this.settings.get("tvOutputLocation") || "")
						.onChange(async (value) => {
							this.settings.set("tvOutputLocation", value);
							await this.settings.saveSettings();
						});
					return text;
				})
				.addButton((btn) =>
					btn
						.setButtonText("Choose")
						.setCta()
						.onClick(() => {
							new FolderPickerModal(this.app, (folder) => {
								const textEls =
									containerEl.querySelectorAll(
										'input[type="text"]',
									);
								const textEl = textEls[4] as HTMLInputElement; // Fifth input
								if (textEl) {
									textEl.value = folder.path;
									textEl.dispatchEvent(new Event("input"));
								}
							}).open();
						}),
				);
		}
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
