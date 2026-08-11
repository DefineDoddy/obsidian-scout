import { Notice, Plugin } from "obsidian";
import { registerCommands } from "./commands";
import type { ScoutContext } from "./core/context";
import { HttpClient } from "./core/http";
import { LibraryIndex } from "./core/library/indexer";
import { LibraryMutator } from "./core/library/mutate";
import { NoteFactory } from "./core/noteFactory";
import type { MediaProvider, ProviderContext } from "./core/provider";
import { ProviderRegistry } from "./core/registry";
import { ScoutSettings } from "./core/settings/store";
import { ScoutSettingTab } from "./core/settings/tab";
import { AniListProvider } from "./providers/anilist/provider";
import { OpenLibraryProvider } from "./providers/openlibrary/provider";
import { TmdbProvider } from "./providers/tmdb/provider";
import { WebLinkProvider } from "./providers/weblink/provider";
import { LIBRARY_VIEW_TYPE, ScoutLibraryView, openLibrary } from "./ui/libraryView";
import { ScoutSearchModal } from "./ui/searchModal";

/**
 * The provider table — the one place a new source is added.
 *
 * The id is declared here rather than read off the instance so the settings
 * scope can be built before construction.
 *
 * Order matters for URL resolution: the registry picks the first provider that
 * claims a link, and WebLink claims *any* http(s) URL, so it stays last as the
 * catch-all.
 */
const PROVIDERS: {
	id: string;
	create: (ctx: ProviderContext) => MediaProvider;
}[] = [
	{ id: "tmdb", create: (ctx) => new TmdbProvider(ctx) },
	{ id: "openlibrary", create: (ctx) => new OpenLibraryProvider(ctx) },
	{ id: "anilist", create: (ctx) => new AniListProvider(ctx) },
	{ id: "weblink", create: (ctx) => new WebLinkProvider(ctx) },
];

/**
 * Plugin lifecycle only. Feature logic lives in `core/`, `providers/`, and `ui/`.
 */
export default class ScoutPlugin extends Plugin {
	private settings!: ScoutSettings;
	private context!: ScoutContext;

	async onload(): Promise<void> {
		this.settings = new ScoutSettings(this);
		await this.settings.load();

		const http = new HttpClient();
		const registry = new ProviderRegistry();

		for (const entry of PROVIDERS) {
			const provider = entry.create({
				http,
				settings: this.settings.scopeFor(entry.id),
			});
			if (provider.id !== entry.id) {
				throw new Error(
					`Provider id mismatch: table says "${entry.id}", instance says "${provider.id}"`,
				);
			}
			registry.register(provider);
		}

		// The index builds itself lazily on first read, so nothing scans the
		// vault during load.
		const library = new LibraryIndex(this.app, this.settings);
		library.register(this);

		this.context = {
			app: this.app,
			settings: this.settings,
			registry,
			factory: new NoteFactory(this.app, this.settings, registry),
			library,
			mutator: new LibraryMutator(this.app, this.settings),
		};

		this.registerView(
			LIBRARY_VIEW_TYPE,
			(leaf) => new ScoutLibraryView(leaf, this.context),
		);

		this.addSettingTab(new ScoutSettingTab(this.app, this, this.context));
		registerCommands(this, this.context);

		this.addRibbonIcon("library-big", "Scout: open library", () =>
			void openLibrary(this.app),
		);
		this.addRibbonIcon("search", "Scout: search", () =>
			new ScoutSearchModal(this.context).open(),
		);

		this.addCommand({
			id: "reload-plugin",
			name: "Reload plugin",
			callback: () => {
				const id = this.manifest.id;
				// @ts-ignore - internal Obsidian API, used for development only
				this.app.plugins.disablePlugin(id).then(() => {
					// @ts-ignore
					this.app.plugins.enablePlugin(id);
					new Notice(`Reloaded ${this.manifest.name}`);
				});
			},
		});
	}

	async onunload(): Promise<void> {
		// Flush any settings change still inside the debounce window.
		await this.settings?.saveNow();
	}
}
