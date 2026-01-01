import { Notice, Plugin } from "obsidian";
import { ScoutSettings } from "./settings";
import { tvSearch } from "./commands/tvSearch";

export default class ScoutPlugin extends Plugin {
	settings = new ScoutSettings(this.app, this);

	async onload() {
		await this.settings.init();

		this.addRibbonIcon(
			"library-big",
			"Open library",
			(_evt: MouseEvent) => {
				new Notice("Opening library...");
			},
		);

		this.addCommand({
			id: "search-movies-tv",
			name: "Search for Movies/TV Shows",
			callback: () => tvSearch(this.app, this.settings),
		});
	}
}
