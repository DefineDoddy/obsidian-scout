import { Modal } from "obsidian";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ScoutContext } from "../core/context";
import { MEDIA_KIND_LABELS, type MediaKind } from "../core/types";
import SearchModalComponent from "./components/SearchModal";

/** Obsidian modal shell hosting the React search UI. */
export class ScoutSearchModal extends Modal {
	private root: Root | null = null;

	constructor(
		private readonly ctx: ScoutContext,
		private readonly initialKind?: MediaKind,
	) {
		super(ctx.app);
	}

	onOpen(): void {
		this.titleEl.setText(
			this.initialKind
				? `Search ${MEDIA_KIND_LABELS[this.initialKind].toLowerCase()}s`
				: "Search",
		);
		this.modalEl.addClass("scout-modal");

		this.root = createRoot(this.contentEl);
		this.root.render(
			React.createElement(SearchModalComponent, {
				ctx: this.ctx,
				initialKind: this.initialKind,
				onClose: () => this.close(),
			}),
		);
	}

	onClose(): void {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
	}
}
