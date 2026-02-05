import { App, Notice } from "obsidian";
import { ScoutSettings } from "../settings";
import { BookSearchModal } from "../ui/BookSearchModal";

export async function bookSearch(app: App, settings: ScoutSettings) {
	if (!settings.get("enableBookFeatures")) {
		new Notice("Book features are disabled in settings");
		return;
	}

	const inputModal = new BookSearchModal(app, settings);
	inputModal.open();
}
