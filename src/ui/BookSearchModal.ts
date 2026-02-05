import { Modal, App } from "obsidian";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ScoutSettings } from "../settings";
import BookSearchModalComponent from "./components/BookSearchModal";

export class BookSearchModal extends Modal {
	private root: Root | null = null;

	constructor(
		app: App,
		private settings: ScoutSettings,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		this.titleEl.setText("Search Books");
		modalEl.addClass("scout-modal");

		this.root = createRoot(contentEl);
		this.root.render(
			React.createElement(BookSearchModalComponent, {
				app: this.app,
				settings: this.settings,
				onClose: () => this.close(),
			}),
		);
	}

	onClose(): void {
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}

		this.contentEl.empty();
	}
}
