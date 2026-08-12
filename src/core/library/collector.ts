import type { Plugin } from "obsidian";
import type { ScoutSettings } from "../settings/store";
import {
	collectionMembers,
	qualifying,
	withCollection,
	type CollectionDef,
} from "./collections";
import type { LibraryEntry } from "./entry";
import type { LibraryIndex } from "./indexer";
import type { LibraryMutator } from "./mutate";

/**
 * The standing order.
 *
 * A collection with a rule is a promise that anything qualifying ends up in it,
 * including the things that qualify tomorrow. Somebody has to keep that promise
 * after the moment the collection was made, and this is that somebody: it
 * watches the index and, whenever the library changes, adds whatever has newly
 * become eligible.
 *
 * Three things keep it from being a nuisance:
 *
 * - It writes only additions, and only ever the collections property. A rule
 *   deciding a note no longer qualifies does *not* take it out — you put things
 *   on a shelf, time does not take them off — and removals you make by hand are
 *   remembered so the rule cannot undo them.
 * - It settles. Adding a note changes the index, which fires this again, which
 *   finds nothing new. One extra pass, then quiet.
 * - It waits. Runs are debounced, skipped while one is in flight, and never
 *   started during load, so a vault opening does not begin with fifty writes.
 */

/** Long enough that a burst of edits, or its own writes, arrive as one change. */
const SETTLE_MS = 1200;

/** After load, so opening Obsidian is never slower for this being installed. */
const FIRST_RUN_DELAY_MS = 8000;

/** Notes one pass will write, so a broad new rule cannot stall the app. */
const BATCH = 60;

export interface CollectResult {
	/** Notes written. */
	added: number;
	/** Collections that took something. */
	collections: number;
}

export class CollectionKeeper {
	private timer: number | null = null;
	private running = false;

	constructor(
		private readonly settings: ScoutSettings,
		private readonly library: LibraryIndex,
		private readonly mutator: LibraryMutator,
	) {}

	/** Watches the library. Everything registered here unloads with the plugin. */
	register(plugin: Plugin): void {
		plugin.register(this.library.subscribe(() => this.schedule(SETTLE_MS)));
		// A rule edited in the collections dialog is a change to what qualifies,
		// which is exactly the same event as a note being edited into range.
		plugin.register(this.settings.onChange(() => this.schedule(SETTLE_MS)));
		this.schedule(FIRST_RUN_DELAY_MS);
		plugin.register(() => {
			if (this.timer !== null) window.clearTimeout(this.timer);
		});
	}

	private schedule(delay: number): void {
		if (this.settings.collections().every((c) => !c.auto)) return;
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.run();
		}, delay);
	}

	/**
	 * One pass over every automatic collection.
	 *
	 * Also the one-off sweep a newly created collection needs: "everything that
	 * qualifies now" and "everything that qualifies later" are the same question
	 * asked at different times, so they are the same code.
	 */
	async run(now: Date = new Date()): Promise<CollectResult> {
		const result: CollectResult = { added: 0, collections: 0 };
		if (this.running) return result;
		this.running = true;

		try {
			const config = this.settings.library();
			const entries = this.library.all();

			for (const collection of this.settings.collections()) {
				const pending = qualifying(entries, collection, config, now);
				if (pending.length === 0) continue;
				result.collections++;

				for (const entry of pending.slice(0, BATCH - result.added)) {
					// Re-read: earlier collections in this same pass may have
					// written to this note, and the index has not caught up.
					const fresh = this.library.byPath(entry.path) ?? entry;
					const ok = await this.mutator.setCollections(
						fresh,
						withCollection(fresh, collection),
						true,
					);
					if (ok) result.added++;
				}
				if (result.added >= BATCH) break;
			}
		} finally {
			this.running = false;
		}
		return result;
	}

	/**
	 * Fills one collection immediately, for the moment it is created or its rule
	 * is changed — where waiting a second and a quarter for the standing order to
	 * notice would look like nothing having happened.
	 *
	 * Asked for by hand, so it does not care whether the collection adds things
	 * on its own: pressing the button *is* the decision to add them this once,
	 * which is exactly what a hand-picked collection with a gate wants.
	 */
	async fill(
		collection: CollectionDef,
		now: Date = new Date(),
	): Promise<number> {
		const config = this.settings.library();
		const entries = this.library.all();
		const pending = qualifying(
			entries,
			{ ...collection, auto: true },
			config,
			now,
		);
		let added = 0;
		for (const entry of pending) {
			const fresh = this.library.byPath(entry.path) ?? entry;
			const ok = await this.mutator.setCollections(
				fresh,
				withCollection(fresh, collection),
				true,
			);
			if (ok) added++;
		}
		return added;
	}

	/** What is in a collection right now, straight off the index. */
	members(collection: CollectionDef): LibraryEntry[] {
		return collectionMembers(this.library.all(), collection);
	}
}
