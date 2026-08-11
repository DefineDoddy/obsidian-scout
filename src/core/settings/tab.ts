import { App, Plugin, PluginSettingTab, setIcon } from "obsidian";
import type { ScoutContext } from "../context";
import { generalSection } from "./sections/general";
import { librarySection } from "./sections/library";
import { notesSection } from "./sections/notes";
import { propertiesSection } from "./sections/properties";
import { sourcesSection } from "./sections/sources";
import { templatesSection } from "./sections/templates";
import type { SectionContext, SettingsSection } from "./sections/types";

/**
 * The settings tab.
 *
 * A single scrolling page stopped being usable once the library added its own
 * dozen settings, so the tab is now a tab bar over independent sections. The
 * shell knows nothing about any of them beyond this list.
 */
const SECTIONS: readonly SettingsSection[] = [
	generalSection,
	notesSection,
	librarySection,
	propertiesSection,
	sourcesSection,
	templatesSection,
];

export class ScoutSettingTab extends PluginSettingTab {
	/** Survives a redraw so changing a setting does not throw you back to page one. */
	private activeId = SECTIONS[0]?.id ?? "general";

	constructor(
		app: App,
		plugin: Plugin,
		private readonly scout: ScoutContext,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("scout-settings");

		const active =
			SECTIONS.find((s) => s.id === this.activeId) ?? SECTIONS[0];
		if (!active) return;

		this.renderTabBar(containerEl, active);

		if (active.intro) {
			containerEl.createEl("p", {
				text: active.intro,
				cls: "scout-tab-intro",
			});
		}

		const body = containerEl.createDiv({ cls: "scout-tab-body" });
		const ctx: SectionContext = {
			...this.scout,
			rerender: () => this.display(),
		};
		active.render(body, ctx);
	}

	private renderTabBar(
		container: HTMLElement,
		active: SettingsSection,
	): void {
		const bar = container.createDiv({ cls: "scout-settings-tabs" });
		bar.setAttribute("role", "tablist");

		for (const section of SECTIONS) {
			const button = bar.createEl("button", { attr: { type: "button" } });
			button.setAttribute("role", "tab");
			const isActive = section.id === active.id;
			button.setAttribute("aria-selected", String(isActive));
			if (isActive) button.addClass("is-active");

			const icon = button.createSpan({ cls: "scout-icon" });
			setIcon(icon, section.icon);
			button.appendText(section.label);

			button.onclick = () => {
				this.activeId = section.id;
				this.display();
			};
		}
	}
}
