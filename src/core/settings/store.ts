import type { Plugin } from "obsidian";
import {
	normalizeCollections,
	type CollectionDef,
} from "../library/collections";
import {
	normalizeLibraryConfig,
	type LibraryConfig,
} from "../library/config";
import {
	normalizeFeedback,
	normalizeShown,
	pruneShown,
	type FeedbackLog,
	type FeedbackRecord,
	type ShownLog,
} from "../library/feedback";
import {
	normalizeEnrichment,
	type EnrichmentCache,
	type EnrichmentRecord,
} from "../library/enrich";
import type { CollisionPolicy } from "../noteWriter";
import { normalizeViews, type SavedView } from "../library/views";
import type { MediaKind } from "../types";
import type { SettingsScope } from "./types";

/**
 * Settings storage.
 *
 * Restructured from a flat bag of `movieTemplateFilePath`-style keys into four
 * groups, because the flat shape forced a schema edit for every new provider:
 *
 * - `core`     plugin-wide behaviour
 * - `kinds`    where each media kind's notes go, independent of which provider
 *              supplied the metadata (so a new provider reuses existing config)
 * - `library`  how notes already in the vault are read, shown, and edited
 * - `providers` one namespace per provider, handed out as a scoped accessor
 */

export const SCHEMA_VERSION = 3;

export type ViewMode = "list" | "grid";

export interface KindConfig {
	templatePath: string;
	outputFolder: string;
}

/** What clicking a search result does. */
export type ResultAction = "detail" | "create";

export interface CoreConfig {
	collisionPolicy: CollisionPolicy;
	openAfterCreate: boolean;
	defaultViewMode: ViewMode;
	/** Warn when a template references fields the provider does not supply. */
	warnOnMissingFields: boolean;
	resultAction: ResultAction;
}

export interface ScoutData {
	schemaVersion: number;
	core: CoreConfig;
	kinds: Partial<Record<MediaKind, KindConfig>>;
	library: LibraryConfig;
	providers: Record<string, Record<string, unknown>>;
	/**
	 * When each note was last asked about, `YYYY-MM-DD` by note path.
	 *
	 * The one thing Scout keeps outside the notes, and deliberately: most
	 * checks find nothing changed, and stamping a property on every note every
	 * few days to record that would put the whole library at the top of
	 * "recently updated" for no reason anybody asked for. Losing this file
	 * costs one extra round of checks and nothing else.
	 */
	checked: Record<string, string>;
	/**
	 * Suggestions you liked or passed on, keyed `providerId:id`.
	 *
	 * Outside the vault for the same reason as `checked`: a thumbs-down is a
	 * fact about something you decided *not* to keep, and writing a note for
	 * each one would fill the library with the opposite of a library.
	 */
	feedback: FeedbackLog;
	/**
	 * When each suggestion was last put in front of you, `providerId:id` to
	 * epoch milliseconds.
	 *
	 * The row used to hold this in memory only, so closing Obsidian and opening
	 * it again brought back the same seven titles — which reads as "this is not
	 * learning" more loudly than any ranking error. Losing this file costs one
	 * repeated row and nothing else.
	 */
	shown?: ShownLog;
	/**
	 * What the sources have said about your library beyond what its notes hold.
	 *
	 * Scout's working notes, and emphatically not yours: keywords, cast and
	 * crew, kept here precisely so they never end up in your frontmatter.
	 * Losing this file costs a few days of quiet background reading and nothing
	 * else.
	 */
	enrichment?: EnrichmentCache;
	/**
	 * Saved library views, in the order their tabs appear.
	 *
	 * Configuration rather than content: a view owns no items, it only says how
	 * to look at the ones the vault already holds. Losing this file loses the
	 * arrangement and nothing else.
	 */
	views: SavedView[];
	/**
	 * Collection definitions — the name, the glyph, and the rule.
	 *
	 * Membership is *not* here: that lives in each note's frontmatter, because a
	 * note being in a collection is a fact about the note. What is here is the
	 * standing order that puts it there.
	 */
	collections: CollectionDef[];
	/**
	 * Whether the one-time type views have been offered.
	 *
	 * The library used to carry a row of "All / Films / TV / Books" pills, which
	 * were a second, weaker views bar: same job, no naming, no conditions, no
	 * deleting. They are seeded as ordinary views instead — and this flag is what
	 * stops them coming back after you throw them away.
	 */
	seededViews?: boolean;
}

const DEFAULT_CORE: CoreConfig = {
	collisionPolicy: "prompt",
	openAfterCreate: true,
	defaultViewMode: "grid",
	warnOnMissingFields: true,
	resultAction: "detail",
};

function emptyData(): ScoutData {
	return {
		schemaVersion: SCHEMA_VERSION,
		core: { ...DEFAULT_CORE },
		kinds: {},
		library: normalizeLibraryConfig(undefined),
		providers: {},
		checked: {},
		feedback: {},
		shown: {},
		enrichment: {},
		views: [],
		collections: [],
	};
}

/* --------------------------------------------------------------- migration */

/** Flat v1 keys → their v2 home. */
const V1_KIND_KEYS: Record<string, [MediaKind, keyof KindConfig]> = {
	movieTemplateFilePath: ["movie", "templatePath"],
	movieOutputLocation: ["movie", "outputFolder"],
	tvShowTemplateFilePath: ["tv", "templatePath"],
	tvShowOutputLocation: ["tv", "outputFolder"],
	// Keys from an even earlier build that shipped without the "Show" infix.
	tvTemplateFilePath: ["tv", "templatePath"],
	tvOutputLocation: ["tv", "outputFolder"],
	bookTemplateFilePath: ["book", "templatePath"],
	bookOutputLocation: ["book", "outputFolder"],
};

/**
 * Upgrades a v1 (flat) blob in place. Existing installs keep their template
 * paths, output folders, and token rather than silently resetting.
 *
 * v2 → v3 only adds the `library` section, so a v2 blob needs no rewriting
 * beyond having the new defaults filled in.
 */
export function migrate(raw: Record<string, unknown> | null): ScoutData {
	if (!raw || typeof raw !== "object") return emptyData();
	if (typeof raw.schemaVersion === "number" && raw.schemaVersion >= 2) {
		const data = raw as unknown as ScoutData;
		const library = normalizeLibraryConfig(data.library);
		return {
			schemaVersion: SCHEMA_VERSION,
			core: { ...DEFAULT_CORE, ...data.core },
			kinds: data.kinds ?? {},
			library,
			providers: data.providers ?? {},
			checked: data.checked ?? {},
			feedback: normalizeFeedback(data.feedback),
			shown: normalizeShown(data.shown),
			enrichment: normalizeEnrichment(data.enrichment),
			views: normalizeViews(data.views, library),
			collections: normalizeCollections(data.collections),
			...(data.seededViews ? { seededViews: true } : {}),
		};
	}

	const next = emptyData();

	for (const [oldKey, [kind, field]] of Object.entries(V1_KIND_KEYS)) {
		const value = raw[oldKey];
		if (typeof value !== "string" || value === "") continue;
		const config = next.kinds[kind] ?? { templatePath: "", outputFolder: "" };
		// The first non-empty value wins, so the newer "tvShow*" keys take
		// precedence over the legacy "tv*" ones when both are present.
		if (!config[field]) config[field] = value;
		next.kinds[kind] = config;
	}

	if (typeof raw.tmdbAccessToken === "string" && raw.tmdbAccessToken) {
		next.providers.tmdb = { accessToken: raw.tmdbAccessToken };
	}
	if (typeof raw.enableTvFeatures === "boolean") {
		next.providers.tmdb = {
			...next.providers.tmdb,
			enabled: raw.enableTvFeatures,
		};
	}
	if (typeof raw.enableBookFeatures === "boolean") {
		// v1's book source was Goodreads, which has since been removed; the
		// toggle carries over to Open Library, which replaced it.
		next.providers.openlibrary = { enabled: raw.enableBookFeatures };
	}
	if (raw.lastViewMode === "list" || raw.lastViewMode === "grid") {
		next.core.defaultViewMode = raw.lastViewMode;
	}

	return next;
}

/* ------------------------------------------------------------------- store */

export class ScoutSettings {
	private data: ScoutData = emptyData();
	/** Coalesces bursts of writes (e.g. typing in a text field) into one save. */
	private saveTimer: number | null = null;
	private readonly listeners = new Set<() => void>();

	constructor(private readonly plugin: Plugin) {}

	async load(): Promise<void> {
		const raw = (await this.plugin.loadData()) as Record<
			string,
			unknown
		> | null;
		const migrated = migrate(raw);
		const wasUpgraded =
			!raw ||
			typeof raw.schemaVersion !== "number" ||
			raw.schemaVersion < SCHEMA_VERSION;
		this.data = migrated;
		// Persist immediately after an upgrade so the stale flat keys are dropped.
		if (wasUpgraded) await this.saveNow();
	}

	/**
	 * Notifies open views that something changed. The library view reads the
	 * field map and layout on every render, so a settings edit has to reach it
	 * without the user closing and reopening the tab.
	 */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}

	async saveNow(): Promise<void> {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		await this.plugin.saveData(this.data);
	}

	private scheduleSave(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.plugin.saveData(this.data);
		}, 400);
	}

	core<K extends keyof CoreConfig>(key: K): CoreConfig[K] {
		return this.data.core[key];
	}

	setCore<K extends keyof CoreConfig>(key: K, value: CoreConfig[K]): void {
		this.data.core[key] = value;
		this.scheduleSave();
		this.notify();
	}

	library(): Readonly<LibraryConfig> {
		return this.data.library;
	}

	setLibrary<K extends keyof LibraryConfig>(
		key: K,
		value: LibraryConfig[K],
	): void {
		this.data.library[key] = value;
		this.scheduleSave();
		this.notify();
	}

	/** Patches one entry of a per-kind map (aliases, statuses) or the field map. */
	setLibraryEntry<K extends "fields" | "kindAliases" | "statuses">(
		group: K,
		key: keyof LibraryConfig[K],
		value: string,
	): void {
		const bucket = this.data.library[group] as Record<string, string>;
		bucket[key as string] = value;
		this.scheduleSave();
		this.notify();
	}

	kind(kind: MediaKind): KindConfig {
		return this.data.kinds[kind] ?? { templatePath: "", outputFolder: "" };
	}

	setKind<K extends keyof KindConfig>(
		kind: MediaKind,
		key: K,
		value: KindConfig[K],
	): void {
		this.data.kinds[kind] = { ...this.kind(kind), [key]: value };
		this.scheduleSave();
		this.notify();
	}

	/* -------------------------------------------------- the refresh log */

	checkLog(): Readonly<Record<string, string>> {
		return this.data.checked;
	}

	/** Records that a note was asked about today, whatever the answer was. */
	markChecked(path: string, day: string): void {
		this.data.checked[path] = day;
		this.scheduleSave();
	}

	/** Replaces the log wholesale, for pruning after a run. No notification. */
	setCheckLog(log: Record<string, string>): void {
		this.data.checked = log;
		this.scheduleSave();
	}

	/* ------------------------------------------------ suggestion feedback */

	feedback(): Readonly<FeedbackLog> {
		return this.data.feedback;
	}

	/** Records a verdict, or clears one when the same button is pressed again. */
	setFeedback(key: string, record: FeedbackRecord | null): void {
		// Replaced rather than mutated: the hub memoizes the taste model on this
		// object, and a mutation in place is a change nothing downstream can see.
		const next = { ...this.data.feedback };
		if (record) next[key] = record;
		else delete next[key];
		this.data.feedback = next;
		this.scheduleSave();
		// Loud, unlike the refresh log: the hub re-ranks on every verdict, which
		// is the whole point of a button that says it is training something.
		this.notify();
	}

	clearFeedback(): void {
		this.data.feedback = {};
		this.scheduleSave();
		this.notify();
	}

	/* --------------------------------------------------------- what was shown */

	shownLog(): Readonly<ShownLog> {
		return this.data.shown ?? {};
	}

	/**
	 * Stamps a row as having been seen.
	 *
	 * Quiet, unlike a verdict: the row writing down what it has just drawn must
	 * not cause the row to be redrawn, which would be a loop. It is read on the
	 * next build, which is exactly when it is wanted.
	 */
	markShown(keys: readonly string[], now: Date = new Date()): void {
		if (keys.length === 0) return;
		const next = { ...(this.data.shown ?? {}) };
		for (const key of keys) next[key] = now.getTime();
		this.data.shown = pruneShown(next, now);
		this.scheduleSave();
	}

	clearShown(): void {
		this.data.shown = {};
		this.scheduleSave();
		this.notify();
	}

	/* ------------------------------------------------------------ enrichment */

	enrichment(): Readonly<EnrichmentCache> {
		return this.data.enrichment ?? {};
	}

	/**
	 * Files one harvest. Quiet: a run writes fifteen of these in a row, and
	 * redrawing the hub after each would be fifteen rebuilds of the model for
	 * one run's worth of new facts. The enricher calls `touch` once at the end.
	 */
	setEnrichment(key: string, record: EnrichmentRecord | null): void {
		const next = { ...(this.data.enrichment ?? {}) };
		if (record) next[key] = record;
		else delete next[key];
		this.data.enrichment = next;
		this.scheduleSave();
	}

	/** Replaces the cache wholesale, for pruning after a run. No notification. */
	setEnrichmentAll(cache: EnrichmentCache): void {
		this.data.enrichment = cache;
		this.scheduleSave();
	}

	clearEnrichment(): void {
		this.data.enrichment = {};
		this.scheduleSave();
		this.notify();
	}

	/** Replaces the feedback log wholesale, for pruning. No notification. */
	setFeedbackAll(log: FeedbackLog): void {
		this.data.feedback = log;
		this.scheduleSave();
	}

	/** Says something changed without anything in particular having changed. */
	touch(): void {
		this.notify();
	}

	/* -------------------------------------------------- views & collections */

	/**
	 * Both lists are replaced rather than edited in place, for the same reason
	 * the feedback log is: the views that render them memoize on the array, and
	 * a push nothing can see is a change that does not appear until something
	 * else happens to re-render.
	 */

	views(): readonly SavedView[] {
		return this.data.views;
	}

	/** Adds a view, or replaces the one with the same id. */
	saveView(view: SavedView): void {
		const at = this.data.views.findIndex((v) => v.id === view.id);
		const next = [...this.data.views];
		if (at === -1) next.push(view);
		else next[at] = view;
		this.data.views = next;
		this.scheduleSave();
		this.notify();
	}

	removeView(id: string): void {
		this.data.views = this.data.views.filter((view) => view.id !== id);
		this.scheduleSave();
		this.notify();
	}

	/** Moves a view one place along its bar. */
	moveView(id: string, delta: number): void {
		const from = this.data.views.findIndex((view) => view.id === id);
		if (from === -1) return;
		const to = Math.min(Math.max(from + delta, 0), this.data.views.length - 1);
		if (to === from) return;
		const next = [...this.data.views];
		const [moved] = next.splice(from, 1);
		if (moved) next.splice(to, 0, moved);
		this.data.views = next;
		this.scheduleSave();
		this.notify();
	}

	/** Whether the one-time type views have already been offered. */
	viewsSeeded(): boolean {
		return this.data.seededViews === true;
	}

	/**
	 * Puts the starter views in, once.
	 *
	 * The flag is set whatever happens, including when the list is empty,
	 * because "you have no types worth a tab" is an answer too — and asking the
	 * question again on every load would put deleted tabs back.
	 */
	seedViews(views: readonly SavedView[]): void {
		if (this.data.seededViews) return;
		this.data.seededViews = true;
		if (views.length > 0) this.data.views = [...this.data.views, ...views];
		this.scheduleSave();
		this.notify();
	}

	collections(): readonly CollectionDef[] {
		return this.data.collections;
	}

	collection(id: string): CollectionDef | undefined {
		return this.data.collections.find((item) => item.id === id);
	}

	saveCollection(collection: CollectionDef): void {
		const at = this.data.collections.findIndex((c) => c.id === collection.id);
		const next = [...this.data.collections];
		if (at === -1) next.push(collection);
		else next[at] = collection;
		this.data.collections = next;
		this.scheduleSave();
		this.notify();
	}

	/**
	 * Forgets the definition. The notes keep the property, which is deliberate:
	 * deleting a collection should not go and edit fifty notes, and re-creating
	 * one under the same name finds its members waiting.
	 */
	removeCollection(id: string): void {
		this.data.collections = this.data.collections.filter((c) => c.id !== id);
		this.scheduleSave();
		this.notify();
	}

	/** Output folders that have been configured, for folder-scoped indexing. */
	configuredFolders(): string[] {
		return Object.values(this.data.kinds)
			.map((config) => config?.outputFolder ?? "")
			.filter((folder) => folder.length > 0);
	}

	/** A namespaced accessor for one provider. */
	scopeFor(providerId: string): SettingsScope {
		return {
			get: <T>(key: string, fallback: T): T => {
				const bucket = this.data.providers[providerId];
				const value = bucket?.[key];
				return value === undefined ? fallback : (value as T);
			},
			set: async (key: string, value: unknown): Promise<void> => {
				const bucket = this.data.providers[providerId] ?? {};
				bucket[key] = value;
				this.data.providers[providerId] = bucket;
				await this.saveNow();
				this.notify();
			},
		};
	}

	/** Providers default to enabled unless explicitly turned off. */
	isProviderEnabled(providerId: string): boolean {
		return this.scopeFor(providerId).get("enabled", true);
	}

	raw(): Readonly<ScoutData> {
		return this.data;
	}
}
