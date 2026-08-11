import { ItemView, type App, type WorkspaceLeaf } from "obsidian";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ScoutContext } from "../core/context";
import LibraryViewComponent from "./components/LibraryView";

export const LIBRARY_VIEW_TYPE = "scout-library";

/** Workspace view hosting the React library browser. */
export class ScoutLibraryView extends ItemView {
	private root: Root | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly ctx: ScoutContext,
	) {
		super(leaf);
	}

	getViewType(): string {
		return LIBRARY_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Library";
	}

	getIcon(): string {
		return "library-big";
	}

	protected async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("scout-library-container");

		this.root = createRoot(container);
		this.root.render(
			React.createElement(LibraryViewComponent, { ctx: this.ctx }),
		);
	}

	protected async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
	}
}

/** Focuses the library, reusing the open one rather than stacking duplicates. */
export async function openLibrary(app: App): Promise<void> {
	const existing = app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
	const leaf = existing[0] ?? app.workspace.getLeaf("tab");
	if (!existing[0]) {
		await leaf.setViewState({ type: LIBRARY_VIEW_TYPE, active: true });
	}
	await app.workspace.revealLeaf(leaf);
}
