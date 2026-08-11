import { Setting } from "obsidian";
import { MEDIA_KIND_LABELS } from "../../types";
import { addPathSetting } from "../controls";
import type { SettingsSection } from "./types";

/**
 * Template and output folder per media kind.
 *
 * Keyed by kind rather than by provider, so adding a second book source reuses
 * the book configuration instead of introducing a parallel set of settings.
 */
export const notesSection: SettingsSection = {
	id: "notes",
	label: "Notes",
	icon: "file-text",
	intro: "Where each kind of note is created, and which template it uses. Templates are optional — every kind has a built-in one.",

	render(container, { app, settings, registry }) {
		const kinds = [
			...new Set(
				registry
					.all()
					.filter((p) => settings.isProviderEnabled(p.id))
					.flatMap((p) => p.kinds),
			),
		];

		if (kinds.length === 0) {
			container.createEl("p", {
				text: "Enable a source first — the kinds it offers appear here.",
				cls: "scout-tab-intro",
			});
			return;
		}

		for (const kind of kinds) {
			const label = MEDIA_KIND_LABELS[kind];
			const config = settings.kind(kind);

			new Setting(container).setName(label).setHeading();

			addPathSetting(app, container, {
				name: "Folder",
				desc: `Where ${label.toLowerCase()} notes are created.`,
				placeholder: "e.g. Media/Movies",
				value: config.outputFolder,
				type: "folder",
				onChange: (v) => settings.setKind(kind, "outputFolder", v),
			});

			addPathSetting(app, container, {
				name: "Template",
				desc: "Leave empty to use the built-in template.",
				placeholder: "e.g. Templates/Movie.md",
				value: config.templatePath,
				type: "file",
				extensions: ["md"],
				onChange: (v) => settings.setKind(kind, "templatePath", v),
			});
		}
	},
};
