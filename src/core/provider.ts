import type { HttpClient } from "./http";
import type { SettingDescriptor, SettingsScope } from "./settings/types";
import type {
	Series,
	EpisodeInfo,
	FieldSchema,
	MediaItem,
	MediaKind,
	MediaRef,
	SeasonInfo,
} from "./types";

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

/**
 * Series that come in seasons and episodes.
 *
 * Two calls rather than one: a show's season list is small and comes with the
 * record itself, while its episodes are a request per season and nobody opens
 * a dialog wanting all nine hundred at once.
 */
export interface Episodic {
	seasons(ref: MediaRef, ctx: RequestContext): Promise<SeasonInfo[]>;
	episodes(
		ref: MediaRef,
		season: number,
		ctx: RequestContext,
	): Promise<EpisodeInfo[]>;
}

/** Sources that know an item belongs to a larger set — a film series, mostly. */
export interface SeriesAware {
	series(ref: MediaRef, ctx: RequestContext): Promise<Series | null>;
}

/**
 * Sources that can answer "what else is like this one".
 *
 * One item in, a handful out. Scout does the choosing — which of your titles to
 * ask about, and which of the answers are worth showing — because only the
 * library knows what you have already seen and what you actually like. The
 * source is asked a narrow question it happens to be very good at.
 */
export interface Recommendable {
	similar(ref: MediaRef, ctx: RequestContext): Promise<MediaItem[]>;
}

/**
 * A thing a catalogue knows by name, and by an id if it gave us one.
 *
 * TMDB takes keyword and crew *ids* in a query and returns names in a payload,
 * so a term is only usable as a filter if the id was kept when it was read.
 */
export interface TermRef {
	name: string;
	id?: string;
}

/** What to ask a catalogue for when there is no one title to ask about. */
export interface DiscoverQuery {
	kind: MediaKind;
	/** Genre names, best first. Translated to whatever the source calls them. */
	genres?: readonly string[];
	/** Genre names to keep out of the results. */
	without?: readonly string[];
	/**
	 * Keywords or tags, best first.
	 *
	 * The reason enrichment exists. A genre says which shelf; a keyword says
	 * what the thing is actually about, and "you keep going for time loops" is
	 * not a sentence a model built from eighteen genres can ever produce.
	 */
	keywords?: readonly TermRef[];
	/** Keywords to keep out. */
	withoutKeywords?: readonly TermRef[];
	/** Whoever made it — directors and creators. */
	crew?: readonly TermRef[];
	/** Whoever is in it. */
	people?: readonly TermRef[];
	/** Nothing scoring below this, out of ten. */
	minRating?: number;
	/** Nothing older than this year. */
	fromYear?: number;
	/** Bumped to walk further down the same list rather than repeat it. */
	page?: number;
	/** How to pick from what matches. Defaults to what most people liked. */
	sort?: "popular" | "rated" | "recent";
}

/** What a source can say about a thing beyond what a note would record. */
export interface ProviderTraits {
	keywords?: TermRef[];
	people?: TermRef[];
	directors?: TermRef[];
	studios?: string[];
	series?: { id: string; name: string; total?: number };
	language?: string;
	runtime?: number;
	/** Siblings the source says belong with it — sequels, prequels, side stories. */
	related?: MediaRef[];
}

/**
 * Sources that can say more about a thing than any note ever records.
 *
 * The default note templates write a genre list and a director, because that
 * is what a person wants to read. It is nowhere near enough to recommend on:
 * "Drama, Thriller" is shared by a third of everything ever made. This is how
 * the model gets the keywords, the cast and the crew — kept in Scout's own
 * data file and never written back into the vault, because they are the
 * model's working notes and not yours.
 */
export interface Enrichable {
	traits(ref: MediaRef, ctx: RequestContext): Promise<ProviderTraits | null>;
}

/**
 * Sources that can be asked for titles by description rather than by name.
 *
 * The complement of `Recommendable`, and the reason both exist. "What else is
 * like this one" can only ever return neighbours of things you already have,
 * which on a small or lopsided library is a very small world — ask it enough
 * times and it hands back the same fifty films. Asking the catalogue directly
 * for well-liked science fiction reaches everything the source knows, including
 * the corners nothing you own happens to border.
 */
export interface Discoverable {
	discover(query: DiscoverQuery, ctx: RequestContext): Promise<MediaItem[]>;
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

export function isEpisodic(p: MediaProvider): p is MediaProvider & Episodic {
	return typeof (p as Partial<Episodic>).episodes === "function";
}

export function isSeriesAware(
	p: MediaProvider,
): p is MediaProvider & SeriesAware {
	return typeof (p as Partial<SeriesAware>).series === "function";
}

export function isRecommendable(
	p: MediaProvider,
): p is MediaProvider & Recommendable {
	return typeof (p as Partial<Recommendable>).similar === "function";
}

export function isDiscoverable(
	p: MediaProvider,
): p is MediaProvider & Discoverable {
	return typeof (p as Partial<Discoverable>).discover === "function";
}

export function isEnrichable(p: MediaProvider): p is MediaProvider & Enrichable {
	return typeof (p as Partial<Enrichable>).traits === "function";
}

export function isAuthenticated(
	p: MediaProvider,
): p is MediaProvider & Authenticated {
	return typeof (p as Partial<Authenticated>).authenticate === "function";
}
