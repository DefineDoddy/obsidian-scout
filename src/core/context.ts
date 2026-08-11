import type { App } from "obsidian";
import type { LibraryIndex } from "./library/indexer";
import type { LibraryMutator } from "./library/mutate";
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
}
