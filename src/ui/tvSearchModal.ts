import { Modal, App } from "obsidian";
import { mount, unmount } from "svelte";
import type { ScoutSettings } from "../settings";
import TvSearchModalComponent from "./TvSearchModal.svelte";

export class TvSearchModal extends Modal {
	private component: ReturnType<typeof mount> | null = null;

	constructor(
		app: App,
		private settings: ScoutSettings,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		this.titleEl.setText("Search Movies & TV Shows");
		modalEl.addClass("scout-modal");

		this.component = mount(TvSearchModalComponent, {
			target: contentEl,
			props: {
				app: this.app,
				settings: this.settings,
				onClose: () => this.close(),
			},
		});
	}

	onClose(): void {
		if (this.component) {
			unmount(this.component);
			this.component = null;
		}

		this.contentEl.empty();
	}
}
