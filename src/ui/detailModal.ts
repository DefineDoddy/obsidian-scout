import { Modal } from "obsidian";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ScoutContext } from "../core/context";
import type { MediaItem } from "../core/types";
import ItemDetail from "./components/ItemDetail";

/** Obsidian modal shell hosting the item detail view. */
export class ScoutDetailModal extends Modal {
	private root: Root | null = null;

	constructor(
		private readonly ctx: ScoutContext,
		private readonly target: { item?: MediaItem; entryPath?: string },
	) {
		super(ctx.app);
	}

	onOpen(): void {
		this.modalEl.addClass("scout-modal");
		this.modalEl.addClass("scout-detail-modal");
		// The view renders its own title block, so the header only holds the
		// close button.
		this.titleEl.setText("");

		this.root = createRoot(this.contentEl);
		this.root.render(
			React.createElement(ItemDetail, {
				ctx: this.ctx,
				item: this.target.item,
				entryPath: this.target.entryPath,
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
