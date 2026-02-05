import { App } from "obsidian";
import { ScoutSettings } from "../settings";
import { TvSearchModal } from "../ui/TvSearchModal";

export async function tvSearch(app: App, settings: ScoutSettings) {
	const inputModal = new TvSearchModal(app, settings);
	inputModal.open();
}
