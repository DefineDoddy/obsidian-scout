import { TFile, normalizePath, type App, type Plugin } from "obsidian";
import type { ScoutSettings } from "../settings/store";
import { normalizeTitle } from "../title";
import type { MediaItem, MediaKind, MediaRef } from "../types";
import { splitList } from "./config";
import {
	buildEntry,
	sameEntry,
	type LibraryEntry,
	type NoteSource,
} from "./entry";

/**
 * The library index.
 *
 * Built from Obsidian's metadata cache rather than by reading files, so a
 * full scan costs nothing beyond the cache lookups the app has already done.
 * Updates are incremental — a note that changes is re-parsed on its own — and
 * a full rebuild only happens when settings change the meaning of the data.
 */

function refKey(ref: MediaRef): string {
	return `${ref.providerId}:${ref.kind}:${ref.id}`;
}

function nameKey(kind: MediaKind, title: string, year?: number): string {
	const base = `${kind}:${normalizeTitle(title)}`;
	return year ? `${base}:${year}` : base;
}

export class LibraryIndex {
	private readonly entries = new Map<string, LibraryEntry>();
	private byRef = new Map<string, LibraryEntry>();
	private byName = new Map<string, LibraryEntry>();
	private built = false;
	/**
	 * The last array `all()` handed out, kept until the set actually changes.
	 *
	 * Every view memoizes its filtering, sorting, and grouping on the entry
	 * array, so handing back a fresh copy on each call — which is what this did —
	 * meant a keystroke anywhere re-ran all of it over the whole library. The
	 * snapshot is the identity those memos hang on.
	 */
	private snapshot: readonly LibraryEntry[] | null = null;
	/** Whether `byRef`/`byName` still match the entry set. Rebuilt on demand. */
	private projected = false;
	private readonly listeners = new Set<() => void>();
	private notifyTimer: number | null = null;
	private rebuildTimer: number | null = null;
	/** Signature of the settings that change how a note *parses*. */
	private signature = "";

	constructor(
		private readonly app: App,
		private readonly settings: ScoutSettings,
	) {
		this.signature = this.currentSignature();
	}

	/** Hooks up vault listeners. Everything registered here unloads with the plugin. */
	register(plugin: Plugin): void {
		plugin.registerEvent(
			this.app.metadataCache.on("changed", (file) => this.reindex(file)),
		);
		plugin.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (this.entries.delete(file.path)) this.changed();
			}),
		);
		plugin.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.entries.delete(oldPath);
				if (file instanceof TFile) this.reindex(file);
				else this.changed();
			}),
		);
		// A changed field map or alias list changes what every note parses to.
		plugin.register(this.settings.onChange(() => this.scheduleRebuild()));
		plugin.register(() => {
			if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
			if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
			this.listeners.clear();
		});
	}

	/** Fires after any change to the indexed set. Returns an unsubscribe. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Every entry, as a shared array.
	 *
	 * Stable between changes and not to be mutated by callers — everything that
	 * sorts or filters it already copies first.
	 */
	all(): readonly LibraryEntry[] {
		this.ensureBuilt();
		if (!this.snapshot) this.snapshot = [...this.entries.values()];
		return this.snapshot;
	}

	byPath(path: string): LibraryEntry | undefined {
		this.ensureBuilt();
		return this.entries.get(path);
	}

	/**
	 * The note for a search result, if one exists.
	 *
	 * Source id first — that is exact. Falling back to the title is what makes
	 * the badge work for notes written before Scout, or by another plugin, but
	 * a title is not an identity: films share names often enough that matching
	 * on one alone marked every result of that name as already owned. So the
	 * year has to agree, and a note that carries the same source's id for a
	 * *different* item is definitively not this one.
	 */
	match(item: MediaItem): LibraryEntry | undefined {
		this.ensureProjected();
		const exact = this.byRef.get(refKey(item.ref));
		if (exact) return exact;

		if (item.year) {
			const dated = this.byName.get(
				nameKey(item.ref.kind, item.title, item.year),
			);
			if (dated) return dated;
		}

		const loose = this.byName.get(nameKey(item.ref.kind, item.title));
		if (!loose) return undefined;
		// Same source, different id: the note is another work of the same name,
		// and the id lookup above would have found it if it were this one.
		if (loose.ref && loose.ref.providerId === item.ref.providerId) {
			return undefined;
		}
		// Two years that disagree are two different works, whatever the title.
		if (
			loose.year !== undefined &&
			item.year !== undefined &&
			loose.year !== item.year
		) {
			return undefined;
		}
		return loose;
	}

	find(ref: MediaRef): LibraryEntry | undefined {
		this.ensureProjected();
		return this.byRef.get(refKey(ref));
	}

	/** Forces a full re-parse, e.g. after the field map changes. */
	rebuild(): void {
		this.entries.clear();
		this.built = false;
		this.ensureBuilt();
		this.changed();
	}

	/* ------------------------------------------------------------- internals */

	private ensureBuilt(): void {
		if (this.built) return;
		this.built = true;
		for (const file of this.app.vault.getMarkdownFiles()) {
			const entry = this.parse(file);
			if (entry) this.entries.set(file.path, entry);
		}
		this.invalidate();
	}

	private reindex(file: TFile): void {
		if (file.extension !== "md") return;
		// Nothing is indexed yet, so the first read will pick this file up anyway.
		if (!this.built) return;

		const entry = this.parse(file);
		const before = this.entries.get(file.path);
		// The metadata cache fires for reasons that have nothing to do with the
		// note's own content — a link resolving elsewhere, a cache rebuild on
		// startup, a sync touching a file it did not change. Handing the views a
		// new object each time would re-filter, re-sort and re-render the whole
		// library for a note that reads exactly as it did a moment ago.
		if (entry && before && sameEntry(before, entry)) return;
		if (entry) this.entries.set(file.path, entry);
		else this.entries.delete(file.path);
		if (entry || before) this.changed();
	}

	private parse(file: TFile): LibraryEntry | null {
		if (!this.inScope(file.path)) return null;
		const cache = this.app.metadataCache.getFileCache(file);
		const source: NoteSource = {
			path: file.path,
			basename: file.basename,
			created: file.stat.ctime,
			modified: file.stat.mtime,
			frontmatter: cache?.frontmatter as Record<string, unknown> | undefined,
		};
		return buildEntry(this.settings.library(), source);
	}

	/**
	 * Whether a path is eligible at all.
	 *
	 * Folder scope keeps the index tight in a vault where `type:` is used for
	 * other things; vault scope is the default because it works with no setup.
	 */
	private inScope(path: string): boolean {
		const config = this.settings.library();
		const lower = path.toLowerCase();

		for (const folder of splitList(config.excludeFolders)) {
			if (lower.startsWith(`${normalizePath(folder).toLowerCase()}/`)) {
				return false;
			}
		}
		if (config.scope === "vault") return true;

		const roots = [
			...this.settings.configuredFolders(),
			...splitList(config.includeFolders),
		].map((folder) => normalizePath(folder).toLowerCase());
		// No folders configured yet: fall back to the whole vault rather than
		// showing an empty library with no explanation.
		if (roots.length === 0) return true;
		return roots.some((root) => lower.startsWith(`${root}/`));
	}

	/**
	 * Rebuilds the lookup maps, and only when something asks to look something
	 * up. They serve the search modal alone, so rebuilding them for each of the
	 * hundred notes a sync touches was work nobody had asked for.
	 */
	private ensureProjected(): void {
		this.ensureBuilt();
		if (this.projected) return;
		this.projected = true;
		this.project();
	}

	private project(): void {
		this.byRef = new Map();
		this.byName = new Map();
		for (const entry of this.entries.values()) {
			if (entry.ref) this.byRef.set(refKey(entry.ref), entry);
			// Both a dated and an undated key: the dated one distinguishes two
			// works of the same name, the undated one still finds a note whose
			// frontmatter never recorded a year.
			for (const title of [entry.title, entry.basename]) {
				for (const key of [
					nameKey(entry.kind, title, entry.year),
					nameKey(entry.kind, title),
				]) {
					// First writer wins, so a duplicate cannot displace the original.
					if (!this.byName.has(key)) this.byName.set(key, entry);
				}
			}
		}
	}

	/** Throws away everything derived from the entry set. */
	private invalidate(): void {
		this.snapshot = null;
		this.projected = false;
	}

	private changed(): void {
		this.invalidate();
		this.scheduleNotify();
	}

	private scheduleNotify(): void {
		if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
		this.notifyTimer = window.setTimeout(() => {
			this.notifyTimer = null;
			for (const listener of this.listeners) listener();
		}, 120);
	}

	/**
	 * Settings change often — every layout toggle writes one — but only a few
	 * of them change what a note parses to. Re-reading the whole vault because
	 * someone switched to list view would be a waste, so the rebuild is gated
	 * on a signature of just the settings that matter.
	 */
	private currentSignature(): string {
		const config = this.settings.library();
		return JSON.stringify([
			config.fields,
			config.kindAliases,
			config.scope,
			config.includeFolders,
			config.excludeFolders,
			config.progressTotalFields,
			this.settings.configuredFolders(),
		]);
	}

	private scheduleRebuild(): void {
		if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
		this.rebuildTimer = window.setTimeout(() => {
			this.rebuildTimer = null;
			const next = this.currentSignature();
			if (next === this.signature) {
				// Nothing about parsing changed, but the view still reads
				// display settings from the config, so let it re-render.
				this.scheduleNotify();
				return;
			}
			this.signature = next;
			this.rebuild();
		}, 300);
	}
}
