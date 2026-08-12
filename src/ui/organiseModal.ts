import { Modal } from "obsidian";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ScoutContext } from "../core/context";
import Organise from "./components/Organise";

/** Obsidian modal shell hosting the views and collections editor. */
export class ScoutOrganiseModal extends Modal {
	private root: Root | null = null;

	constructor(
		private readonly ctx: ScoutContext,
		private readonly options: {
			tab?: "views" | "collections";
			select?: string;
		} = {},
	) {
		super(ctx.app);
	}

	onOpen(): void {
		this.modalEl.addClass("scout-modal");
		this.modalEl.addClass("scout-organise-modal");
		this.titleEl.setText("Views and collections");

		this.root = createRoot(this.contentEl);
		this.root.render(
			React.createElement(Organise, {
				ctx: this.ctx,
				tab: this.options.tab,
				select: this.options.select,
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
