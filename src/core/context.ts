import type { App } from "obsidian";
import type { CollectionKeeper } from "./library/collector";
import type { LibraryIndex } from "./library/indexer";
import type { LibraryMutator } from "./library/mutate";
import type { LibraryEnricher } from "./library/enricher";
import type { LibraryRefresher } from "./library/refresher";
import type { NoteFactory } from "./noteFactory";
import type { ProviderRegistry } from "./registry";
import type { ScoutSettings } from "./settings/store";

/**
 * The services every part of the UI needs.
 *
 * Passed as one object rather than five props: the search modal, the detail
 * dialog, and the library view all need most of them, and threading each
 * dependency separately meant editing three signatures to add a sixth.
 */
export interface ScoutContext {
	app: App;
	settings: ScoutSettings;
	registry: ProviderRegistry;
	factory: NoteFactory;
	library: LibraryIndex;
	mutator: LibraryMutator;
	/** Keeps the facts a source owns current, in the background and on demand. */
	refresher: LibraryRefresher;
	/** Reads up on the library in the background, so suggestions can sharpen. */
	enricher: LibraryEnricher;
	/** Keeps automatic collections filled as the library changes. */
	collector: CollectionKeeper;
}
