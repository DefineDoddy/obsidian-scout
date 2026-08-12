import { Notice, Plugin } from "obsidian";
import { registerCommands } from "./commands";
import type { ScoutContext } from "./core/context";
import { HttpClient } from "./core/http";
import { CollectionKeeper } from "./core/library/collector";
import { LibraryIndex } from "./core/library/indexer";
import { LibraryMutator } from "./core/library/mutate";
import { LibraryEnricher } from "./core/library/enricher";
import { LibraryRefresher } from "./core/library/refresher";
import { NoteFactory } from "./core/noteFactory";
import type { MediaProvider, ProviderContext } from "./core/provider";
import { ProviderRegistry } from "./core/registry";
import { ScoutSettings } from "./core/settings/store";
import { ScoutSettingTab } from "./core/settings/tab";
import { AniListProvider } from "./providers/anilist/provider";
import { OpenLibraryProvider } from "./providers/openlibrary/provider";
import { TmdbProvider } from "./providers/tmdb/provider";
import { WebLinkProvider } from "./providers/weblink/provider";
import { HOME_VIEW_TYPE, ScoutHomeView, openHome } from "./ui/homeView";
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

	/**
	 * Loading, and saying so when it does not.
	 *
	 * Obsidian reports a plugin that threw during load as "failed to load" and
	 * puts the reason in the console — which on a desktop is one keystroke away
	 * and on a phone is nowhere at all. Since a phone is exactly where a load
	 * failure is hardest to diagnose, the reason is put on screen. Rethrown
	 * afterwards, so Obsidian still counts the plugin as failed rather than as
	 * loaded and quietly broken.
	 */
	async onload(): Promise<void> {
		try {
			await this.start();
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			new Notice(`Scout could not start: ${reason}`, 15_000);
			throw err;
		}
	}

	private async start(): Promise<void> {
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

		const mutator = new LibraryMutator(this.app, this.settings);
		const refresher = new LibraryRefresher(
			this.settings,
			registry,
			library,
			mutator,
		);

		const collector = new CollectionKeeper(this.settings, library, mutator);
		const enricher = new LibraryEnricher(this.settings, registry, library);

		this.context = {
			app: this.app,
			settings: this.settings,
			registry,
			factory: new NoteFactory(this.app, this.settings, registry),
			library,
			mutator,
			refresher,
			enricher,
			collector,
		};

		// After load, not during it: the first run waits long enough that
		// nothing about starting Obsidian is slower for it being installed.
		refresher.start(this);
		enricher.start(this);
		collector.register(this);

		this.registerView(
			HOME_VIEW_TYPE,
			(leaf) => new ScoutHomeView(leaf, this.context),
		);
		this.registerView(
			LIBRARY_VIEW_TYPE,
			(leaf) => new ScoutLibraryView(leaf, this.context),
		);

		this.addSettingTab(new ScoutSettingTab(this.app, this, this.context));
		registerCommands(this, this.context);

		// The hub first, because it is the one that answers "what now" — the
		// library is where you go when you already know what you are after.
		this.addRibbonIcon("clapperboard", "Scout: home", () =>
			void openHome(this.app),
		);
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
