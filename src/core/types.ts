/**
 * Provider-agnostic domain types.
 *
 * Nothing in this file knows about TMDB, Open Library, or any other source.
 * Every provider maps its own response shape into `MediaItem`, which is the
 * only shape the UI and the template engine ever see.
 */

/** The kinds of thing Scout can create notes for. */
export type MediaKind =
	| "movie"
	| "tv"
	| "book"
	| "game"
	| "anime"
	| "manga"
	| "link";

export const ALL_MEDIA_KINDS: readonly MediaKind[] = [
	"movie",
	"tv",
	"book",
	"game",
	"anime",
	"manga",
	"link",
];

/** Human-readable, sentence-case labels for each kind. */
export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
	movie: "Movie",
	tv: "TV show",
	book: "Book",
	game: "Game",
	anime: "Anime",
	manga: "Manga",
	link: "Web link",
};

/**
 * The same words in the plural, for anything naming a shelf of them.
 *
 * Written out rather than an "s" on the end, because two of them do not take
 * one and "Animes" on a tab is the sort of thing that makes an app look like
 * nobody read it.
 */
export const MEDIA_KIND_PLURALS: Record<MediaKind, string> = {
	movie: "Movies",
	tv: "TV shows",
	book: "Books",
	game: "Games",
	anime: "Anime",
	manga: "Manga",
	link: "Web links",
};

/** Values a template placeholder is allowed to resolve to. */
export type TemplateValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| readonly string[]
	| readonly number[];

/**
 * Stable pointer to an item within a provider. Persisted into note
 * frontmatter so a note can later be matched back to its source.
 */
export interface MediaRef {
	providerId: string;
	kind: MediaKind;
	/** Provider-native id. String because not every provider uses integers. */
	id: string;
}

/**
 * One string naming one thing at one source.
 *
 * Lives here, beside the type it is made from, rather than in whichever module
 * happened to need it first — which was `feedback.ts`, and meant that anything
 * wanting to key something by ref had to import the feedback log to do it.
 * Deliberately excludes the kind: the same id at the same source is the same
 * thing whatever shelf a note filed it under.
 */
export function sourceKey(ref: MediaRef): string {
	return `${ref.providerId}:${ref.id}`;
}

/**
 * Normalized item. Providers fill in what they have; everything is optional
 * except the fields every conceivable source can supply.
 */
export interface MediaItem {
	ref: MediaRef;
	title: string;
	/** Secondary line: original title, author, developer, series… */
	subtitle?: string;
	year?: number;
	/** Normalized to a 0-10 scale regardless of the provider's native scale. */
	rating?: number;
	/** How many people rated it. Used to weight `rating` when ranking. */
	ratingCount?: number;
	/**
	 * Provider-native audience measure — TMDB's popularity float, AniList's
	 * member count, a ratings count. Scales differ wildly between providers, so
	 * ranking only ever compares this against other items from the same source.
	 */
	popularity?: number;
	/** Full-size artwork. */
	imageUrl?: string;
	/** Small artwork for result lists; falls back to `imageUrl`. */
	thumbnailUrl?: string;
	description?: string;
	/** Genres, categories, subjects. */
	tags: string[];
	/** Cast, authors, developers, directors. */
	people: string[];
	/** Canonical page on the provider's own site. */
	externalUrl?: string;
	/** ISO `YYYY-MM-DD` where known. */
	releaseDate?: string;
	/** Provider-specific fields, each declared in the provider's `fields`. */
	extra: Record<string, TemplateValue>;
}

/**
 * One season of a series.
 *
 * Season zero is the specials everywhere it appears, which is why the number
 * is carried rather than the position in the list.
 */
export interface SeasonInfo {
	number: number;
	name: string;
	episodeCount?: number;
	year?: number;
	overview?: string;
	posterUrl?: string;
}

/** One episode. `rating` is normalized to ten, as everywhere else. */
export interface EpisodeInfo {
	season: number;
	number: number;
	title: string;
	overview?: string;
	/** ISO `YYYY-MM-DD` where known. */
	airDate?: string;
	rating?: number;
	/** Minutes. */
	runtime?: number;
	stillUrl?: string;
}

/**
 * A set of items the source says belong together — a film series, a trilogy,
 * the volumes of one work. Named after what the source calls it.
 *
 * Not a collection. A collection is a shelf the user makes and the notes
 * remember; this is a fact about the work that arrives with it and that nobody
 * here can change. TMDB happens to call it a collection, which is where the
 * confusion came from: two things under one word, one of them yours and one of
 * them not.
 */
export interface Series {
	id: string;
	name: string;
	overview?: string;
	items: MediaItem[];
}

/** Declares a template placeholder so settings can document and validate it. */
export interface FieldDescriptor {
	name: string;
	type: "string" | "number" | "boolean" | "date" | "list";
	description: string;
}

export type FieldSchema = readonly FieldDescriptor[];

/**
 * Fields present on every `MediaItem`, and therefore usable in any template
 * regardless of provider.
 */
export const COMMON_FIELDS: FieldSchema = [
	{ name: "title", type: "string", description: "Primary title" },
	{
		name: "subtitle",
		type: "string",
		description: "Original title, author, or studio",
	},
	{ name: "year", type: "number", description: "Release year" },
	{ name: "rating", type: "number", description: "Rating out of 10" },
	{ name: "cover", type: "string", description: "Full-size artwork URL" },
	{ name: "description", type: "string", description: "Synopsis or blurb" },
	{ name: "tags", type: "list", description: "Genres, categories, subjects" },
	{ name: "genres", type: "list", description: "Alias of tags" },
	{ name: "people", type: "list", description: "Cast, authors, creators" },
	{ name: "url", type: "string", description: "Provider page URL" },
	{ name: "release_date", type: "date", description: "Full release date" },
	{ name: "kind", type: "string", description: "Media kind, e.g. movie" },
	{ name: "provider", type: "string", description: "Source provider id" },
	{ name: "id", type: "string", description: "Provider-native id" },
	{ name: "now", type: "date", description: "Today's date" },
];

/** Flattens a `MediaItem` into the placeholder map the template engine takes. */
export function toTemplateContext(
	item: MediaItem,
): Record<string, TemplateValue> {
	return {
		title: item.title,
		subtitle: item.subtitle,
		year: item.year,
		rating: item.rating,
		cover: item.imageUrl,
		description: item.description,
		tags: item.tags,
		// Aliases kept so templates written before the refactor keep working.
		genres: item.tags,
		poster: item.imageUrl,
		people: item.people,
		url: item.externalUrl,
		release_date: item.releaseDate,
		kind: item.ref.kind,
		provider: item.ref.providerId,
		id: item.ref.id,
		now: new Date().toISOString().slice(0, 10),
		...item.extra,
	};
}
