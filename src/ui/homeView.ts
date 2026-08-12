import { ItemView, type App, type WorkspaceLeaf } from "obsidian";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ScoutContext } from "../core/context";
import HomeViewComponent from "./components/HomeView";

export const HOME_VIEW_TYPE = "scout-home";

/** Workspace view hosting the hub. */
export class ScoutHomeView extends ItemView {
	private root: Root | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly ctx: ScoutContext,
	) {
		super(leaf);
	}

	getViewType(): string {
		return HOME_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Scout";
	}

	getIcon(): string {
		return "clapperboard";
	}

	protected async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("scout-home-container");

		this.root = createRoot(container);
		this.root.render(
			React.createElement(HomeViewComponent, { ctx: this.ctx }),
		);
	}

	protected async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
	}
}

/** Focuses the hub, reusing the open one rather than stacking duplicates. */
export async function openHome(app: App): Promise<void> {
	const existing = app.workspace.getLeavesOfType(HOME_VIEW_TYPE);
	const leaf = existing[0] ?? app.workspace.getLeaf("tab");
	if (!existing[0]) {
		await leaf.setViewState({ type: HOME_VIEW_TYPE, active: true });
	}
	await app.workspace.revealLeaf(leaf);
}
