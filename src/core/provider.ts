import type { HttpClient } from "./http";
import type { SettingDescriptor, SettingsScope } from "./settings/types";
import type { FieldSchema, MediaItem, MediaKind, MediaRef } from "./types";

/**
 * Provider contracts.
 *
 * Deliberately split into small capability interfaces so a provider implements
 * only what it can actually do — a web-link provider resolves URLs and has no
 * search endpoint, and nothing forces it to fake one.
 */

/** Everything a provider is given at construction. */
export interface ProviderContext {
	http: HttpClient;
	/** Namespaced to this provider's id. */
	settings: SettingsScope;
}

export interface RequestContext {
	signal: AbortSignal;
	/** Narrows the search when the user has picked a specific kind. */
	kind?: MediaKind;
	/**
	 * The search result being enriched, when calling `details`. Providers whose
	 * detail endpoint returns less than their search endpoint (scrapers, mostly)
	 * use this so no already-known field is lost.
	 */
	previous?: MediaItem;
}

/** The base contract. Every provider satisfies this. */
export interface MediaProvider {
	/** Stable across releases — it namespaces settings and appears in frontmatter. */
	readonly id: string;
	readonly name: string;
	readonly kinds: readonly MediaKind[];
	/** Extra template fields beyond `COMMON_FIELDS`, for docs and validation. */
	readonly fields: FieldSchema;
	/** False when required credentials are missing; the UI explains why. */
	isConfigured(): boolean;
	/** Settings this provider contributes, rendered in its own section. */
	settingsSchema(): readonly SettingDescriptor[];
}

/** Free-text search. */
export interface Searchable {
	search(query: string, ctx: RequestContext): Promise<MediaItem[]>;
}

/**
 * Second-stage fetch for fields the search endpoint omits. Providers whose
 * search response is already complete can skip this.
 */
export interface Detailable {
	details(ref: MediaRef, ctx: RequestContext): Promise<MediaItem>;
}

/** Turns a URL directly into an item, with no search step. */
export interface Resolvable {
	canResolve(url: string): boolean;
	resolve(url: string, ctx: RequestContext): Promise<MediaItem>;
}

/** For providers behind OAuth rather than a pasted token. */
export interface Authenticated {
	authenticate(): Promise<void>;
}

/* Structural narrowing — no `instanceof`, so providers stay plain objects. */

export function isSearchable(p: MediaProvider): p is MediaProvider & Searchable {
	return typeof (p as Partial<Searchable>).search === "function";
}

export function isDetailable(p: MediaProvider): p is MediaProvider & Detailable {
	return typeof (p as Partial<Detailable>).details === "function";
}

export function isResolvable(p: MediaProvider): p is MediaProvider & Resolvable {
	return typeof (p as Partial<Resolvable>).resolve === "function";
}

export function isAuthenticated(
	p: MediaProvider,
): p is MediaProvider & Authenticated {
	return typeof (p as Partial<Authenticated>).authenticate === "function";
}
