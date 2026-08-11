import { Setting } from "obsidian";
import type { CollisionPolicy } from "../../noteWriter";
import { addDropdown, addToggle } from "../controls";
import type { ResultAction, ViewMode } from "../store";
import type { SettingsSection } from "./types";

/** Plugin-wide behaviour: what a click does, and what happens on a clash. */
export const generalSection: SettingsSection = {
	id: "general",
	label: "General",
	icon: "settings",
	intro: "How Scout behaves when you search and when it writes a note.",

	render(container, { settings }) {
		new Setting(container).setName("Searching").setHeading();

		addDropdown<ResultAction>(container, {
			name: "Clicking a search result",
			desc: "Open the full details, or create the note straight away. The + button on each result always creates it directly.",
			value: settings.core("resultAction"),
			options: {
				detail: "Show details",
				create: "Create the note",
			},
			onChange: (v) => settings.setCore("resultAction", v),
		});

		addDropdown<ViewMode>(container, {
			name: "Default result layout",
			value: settings.core("defaultViewMode"),
			options: { grid: "Grid", list: "List" },
			onChange: (v) => settings.setCore("defaultViewMode", v),
		});

		new Setting(container).setName("Creating notes").setHeading();

		addDropdown<CollisionPolicy>(container, {
			name: "When a note already exists",
			desc: "What to do when a note with the same name is already in the output folder.",
			value: settings.core("collisionPolicy"),
			options: {
				prompt: "Ask me",
				open: "Open the existing note",
				increment: "Create a numbered copy",
				overwrite: "Overwrite it",
			},
			onChange: (v) => settings.setCore("collisionPolicy", v),
		});

		addToggle(container, {
			name: "Open note after creating",
			value: settings.core("openAfterCreate"),
			onChange: (v) => settings.setCore("openAfterCreate", v),
		});

		addToggle(container, {
			name: "Warn about unknown template fields",
			desc: "Show a notice when a template uses a placeholder the source does not provide.",
			value: settings.core("warnOnMissingFields"),
			onChange: (v) => settings.setCore("warnOnMissingFields", v),
		});
	},
};
