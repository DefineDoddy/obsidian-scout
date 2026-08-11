import type { Plugin } from "obsidian";
import {
	normalizeLibraryConfig,
	type LibraryConfig,
} from "../library/config";
import type { CollisionPolicy } from "../noteWriter";
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
		return {
			schemaVersion: SCHEMA_VERSION,
			core: { ...DEFAULT_CORE, ...data.core },
			kinds: data.kinds ?? {},
			library: normalizeLibraryConfig(data.library),
			providers: data.providers ?? {},
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
