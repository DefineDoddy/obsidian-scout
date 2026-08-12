import { Notice, Plugin } from "obsidian";
import type { ScoutContext } from "../core/context";
import { isResolvable } from "../core/provider";
import { ALL_MEDIA_KINDS, MEDIA_KIND_LABELS } from "../core/types";
import { ScoutDetailModal } from "../ui/detailModal";
import { openHome } from "../ui/homeView";
import { openLibrary } from "../ui/libraryView";
import { findMissingSourceIds } from "../ui/linkNotes";
import { refreshLibrary } from "../ui/refreshNotes";
import { ScoutSearchModal } from "../ui/searchModal";

/**
 * Command registration.
 *
 * Per-kind commands are generated from the kind list rather than written out
 * one by one, so a provider introducing a new kind gets a command for free.
 * Command ids are stable and must not be renamed once released.
 */
export function registerCommands(plugin: Plugin, ctx: ScoutContext): void {
	const { registry, settings, factory, library } = ctx;

	plugin.addCommand({
		id: "search",
		name: "Search all sources",
		callback: () => new ScoutSearchModal(ctx).open(),
	});

	plugin.addCommand({
		id: "open-home",
		name: "Open home",
		callback: () => void openHome(plugin.app),
	});

	plugin.addCommand({
		id: "open-library",
		name: "Open library",
		callback: () => void openLibrary(plugin.app),
	});

	for (const kind of ALL_MEDIA_KINDS) {
		plugin.addCommand({
			id: `search-${kind}`,
			name: `Search ${MEDIA_KIND_LABELS[kind].toLowerCase()}s`,
			checkCallback: (checking) => {
				// Hidden from the palette unless a source actually offers this kind.
				const available = registry
					.all()
					.some(
						(p) =>
							settings.isProviderEnabled(p.id) &&
							p.kinds.includes(kind),
					);
				if (!available) return false;
				if (!checking) new ScoutSearchModal(ctx, kind).open();
				return true;
			},
		});
	}

	plugin.addCommand({
		id: "manage-current-note",
		name: "Manage this note",
		checkCallback: (checking) => {
			const file = plugin.app.workspace.getActiveFile();
			if (!file) return false;
			const entry = library.byPath(file.path);
			if (!entry) return false;
			if (!checking) {
				new ScoutDetailModal(ctx, { entryPath: entry.path }).open();
			}
			return true;
		},
	});

	plugin.addCommand({
		id: "link-notes-to-sources",
		name: "Find source ids for notes that have none",
		callback: () => void findMissingSourceIds(ctx),
	});

	plugin.addCommand({
		id: "refresh-library",
		name: "Refresh notes that are due a check",
		callback: () => void refreshLibrary(ctx),
	});

	plugin.addCommand({
		id: "create-from-clipboard-url",
		name: "Create note from link in clipboard",
		callback: async () => {
			const text = (await navigator.clipboard.readText()).trim();
			if (!/^https?:\/\//i.test(text)) {
				new Notice("The clipboard does not contain a link.");
				return;
			}

			const provider = registry
				.configured()
				.filter((p) => settings.isProviderEnabled(p.id))
				.filter(isResolvable)
				.find((p) => p.canResolve(text));

			if (!provider) {
				new Notice("No enabled source can handle that link.");
				return;
			}

			const controller = new AbortController();
			try {
				const item = await provider.resolve(text, {
					signal: controller.signal,
				});
				await factory.create(item, controller.signal);
			} catch (err) {
				new Notice(
					`Could not read that link: ${
						err instanceof Error ? err.message : "unknown error"
					}`,
				);
			}
		},
	});
}
