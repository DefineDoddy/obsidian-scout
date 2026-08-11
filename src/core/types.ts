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
