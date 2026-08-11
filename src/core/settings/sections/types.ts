import type { ScoutContext } from "../../context";

/**
 * One tab of the settings dialog.
 *
 * The tab shell knows nothing but this list, so a new page of settings is a
 * new file plus one entry in `SECTIONS` — the same open/closed arrangement the
 * provider registry uses.
 */

/**
 * The whole plugin context, because a settings page is not only a list of
 * values: the library page also runs the same maintenance actions the command
 * palette offers, and those need the note writer as much as the index.
 */
export interface SectionContext extends ScoutContext {
	/** Redraws the whole tab, for settings that reveal or hide others. */
	rerender: () => void;
}

export interface SettingsSection {
	id: string;
	label: string;
	icon: string;
	/** One line under the tab bar explaining what this page is for. */
	intro?: string;
	render(container: HTMLElement, ctx: SectionContext): void;
}
