import { Modal } from "obsidian";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ScoutContext } from "../core/context";
import type { Reason } from "../core/library/reasons";
import type { MediaItem } from "../core/types";
import ItemDetail from "./components/ItemDetail";

/** Obsidian modal shell hosting the item detail view. */
export class ScoutDetailModal extends Modal {
	private root: Root | null = null;

	constructor(
		private readonly ctx: ScoutContext,
		private readonly target: {
			item?: MediaItem;
			entryPath?: string;
			/**
			 * Why the row put this in front of you, when it came from the row.
			 *
			 * A card has room for one of these and the model usually has four.
			 * Carrying them in means the dialog can give the whole account, which
			 * is the only place there is room for it — and it is the answer to
			 * "why am I being shown this", which is a fair question to be able to
			 * ask of anything that suggests things.
			 */
			reasons?: readonly Reason[];
		},
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
				reasons: this.target.reasons,
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
