import { Notice, Plugin } from "obsidian";
import { ScoutSettings } from "./settings";
import { tvSearch } from "./commands/tvSearch";

export default class ScoutPlugin extends Plugin {
	settings = new ScoutSettings(this.app, this);

	async onload() {
		await this.settings.init();

		this.addRibbonIcon("library-big", "Open library", () => {
			new Notice("Opening library...");
		});

		this.addCommand({
			id: "search-movies-tv",
			name: "Search for Movies/TV Shows",
			callback: () => tvSearch(this.app, this.settings),
		});

		this.addCommand({
			id: "reload-plugin",
			name: "Reload plugin",
			callback: () => {
				const id = this.manifest.id;
				// @ts-ignore - access internal Obsidian API to reload plugin
				this.app.plugins.disablePlugin(id).then(() => {
					// @ts-ignore
					this.app.plugins.enablePlugin(id);
					new Notice(`Reloaded ${this.manifest.name}`);
				});
			},
		});
	}
}
