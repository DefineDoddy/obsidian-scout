import type {
	Discoverable,
	DiscoverQuery,
	Enrichable,
	MediaProvider,
	ProviderContext,
	ProviderTraits,
	Recommendable,
	RequestContext,
	Resolvable,
	Searchable,
} from "../../core/provider";
import type { SettingDescriptor } from "../../core/settings/types";
import type {
	FieldSchema,
	MediaItem,
	MediaKind,
	MediaRef,
} from "../../core/types";

/**
 * AniList (anime and manga).
 *
 * Keyless GraphQL. Included specifically to prove the provider abstraction is
 * not REST-shaped: this one POSTs a query document and never builds a URL path,
 * yet needs no changes anywhere outside this file. Its search response is
 * already complete, so it implements `Searchable` but not `Detailable`.
 */

const ENDPOINT = "https://graphql.anilist.co";

/** The one field list, named once. Every query below spreads it. */
const MEDIA_FIELDS = `
fragment MediaFields on Media {
  id
  type
  format
  status
  episodes
  chapters
  volumes
  duration
  averageScore
  popularity
  favourites
  genres
  description(asHtml: false)
  siteUrl
  startDate { year month day }
  title { romaji english native }
  coverImage { large medium }
  studios(isMain: true) { nodes { name } }
  staff(perPage: 5) { nodes { name { full } } }
}`;

const SEARCH_QUERY = `
query ($search: String, $type: MediaType) {
  Page(perPage: 20) {
    media(search: $search, type: $type, sort: SEARCH_MATCH) { ...MediaFields }
  }
}${MEDIA_FIELDS}`;

const BY_ID_QUERY = `
query ($id: Int) {
  Media(id: $id) { ...MediaFields }
}${MEDIA_FIELDS}`;

/**
 * What AniList knows that a note never will.
 *
 * Its tags are the point. AniList has eighteen-odd genres like everyone else,
 * and several hundred *tags* — "time loop", "found family", "unreliable
 * narrator" — ranked by how much each one applies. That is a far better
 * description of what a thing actually is than any genre list, and nothing in
 * Scout was asking for it.
 *
 * Kept out of the shared fragment deliberately: this is one request per title
 * in a background pass, and loading tags and relations onto every search
 * result would make every search heavier for no visible gain.
 */
const TRAITS_QUERY = `
query ($id: Int) {
  Media(id: $id) {
    duration
    countryOfOrigin
    tags { name rank isMediaSpoiler }
    studios(isMain: true) { nodes { id name } }
    staff(perPage: 4) { nodes { id name { full } } }
    characters(perPage: 6, sort: ROLE) { nodes { id name { full } } }
    relations {
      edges {
        relationType
        node { id type }
      }
    }
  }
}`;

/**
 * AniList keeps user-submitted recommendations against each title, with a vote
 * count on every one. Sorted by rating, the top of that list is the closest
 * thing to "people who liked this liked these" that a keyless API offers.
 */
const SIMILAR_QUERY = `
query ($id: Int) {
  Media(id: $id) {
    recommendations(perPage: 20, sort: RATING_DESC) {
      nodes { mediaRecommendation { ...MediaFields } }
    }
  }
}${MEDIA_FIELDS}`;

/**
 * The catalogue by description.
 *
 * Sorted by popularity with a score floor rather than by score: AniList's
 * top-scoring list is dominated by titles a handful of devotees rated 95, and
 * "well liked by many" is the pool worth ranking against a taste profile.
 */
const DISCOVER_QUERY = `
query ($type: MediaType, $genres: [String], $tags: [String], $score: Int, $year: FuzzyDateInt, $page: Int) {
  Page(page: $page, perPage: 20) {
    media(
      type: $type
      genre_in: $genres
      tag_in: $tags
      averageScore_greater: $score
      startDate_greater: $year
      isAdult: false
      sort: POPULARITY_DESC
    ) { ...MediaFields }
  }
}${MEDIA_FIELDS}`;

interface AniListMedia {
	id: number;
	type?: "ANIME" | "MANGA";
	format?: string;
	status?: string;
	episodes?: number | null;
	chapters?: number | null;
	volumes?: number | null;
	duration?: number | null;
	averageScore?: number | null;
	popularity?: number | null;
	favourites?: number | null;
	genres?: string[];
	description?: string | null;
	siteUrl?: string;
	startDate?: { year?: number | null; month?: number | null; day?: number | null };
	title?: { romaji?: string; english?: string; native?: string };
	coverImage?: { large?: string; medium?: string };
	studios?: { nodes?: { name: string }[] };
	staff?: { nodes?: { name?: { full?: string } }[] };
}

/**
 * What counts as "belongs with this one".
 *
 * Adaptations and alternative versions are excluded on purpose: the manga a
 * series was adapted from is the same story told again, and offering it to
 * somebody who has just watched the series is offering them what they have
 * already had.
 */
const RELATED_KINDS = new Set([
	"SEQUEL",
	"PREQUEL",
	"SIDE_STORY",
	"PARENT",
	"SPIN_OFF",
]);

interface AniListTraits {
	duration?: number | null;
	countryOfOrigin?: string | null;
	tags?: { name: string; rank?: number | null; isMediaSpoiler?: boolean }[];
	studios?: { nodes?: { id: number; name: string }[] };
	staff?: { nodes?: { id: number; name?: { full?: string } }[] };
	characters?: { nodes?: { id: number; name?: { full?: string } }[] };
	relations?: {
		edges?: { relationType?: string; node?: { id: number; type?: string } }[];
	};
}

interface GraphQLResponse<T> {
	data?: T;
	errors?: { message: string }[];
}

/** AniList descriptions carry a little HTML even with asHtml: false. */
function stripHtml(text: string | null | undefined): string | undefined {
	if (!text) return undefined;
	return (
		text
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<[^>]+>/g, "")
			.replace(/&amp;/g, "&")
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/\n{3,}/g, "\n\n")
			.trim() || undefined
	);
}

function isoDate(date: AniListMedia["startDate"]): string | undefined {
	if (!date?.year) return undefined;
	const month = String(date.month ?? 1).padStart(2, "0");
	const day = String(date.day ?? 1).padStart(2, "0");
	return `${date.year}-${month}-${day}`;
}

function toItem(media: AniListMedia): MediaItem {
	const kind: MediaKind = media.type === "MANGA" ? "manga" : "anime";
	const title =
		media.title?.english ?? media.title?.romaji ?? media.title?.native ?? "Untitled";
	const studios = media.studios?.nodes?.map((n) => n.name) ?? [];
	const staff =
		media.staff?.nodes
			?.map((n) => n.name?.full)
			.filter((n): n is string => Boolean(n)) ?? [];

	return {
		ref: { providerId: "anilist", kind, id: String(media.id) },
		title,
		subtitle: media.title?.romaji !== title ? media.title?.romaji : undefined,
		year: media.startDate?.year ?? undefined,
		// AniList scores out of 100; Scout normalizes every source to 0-10.
		rating:
			typeof media.averageScore === "number"
				? Math.round(media.averageScore) / 10
				: undefined,
		// AniList reports no vote count, so the number of users with the title
		// on a list stands in for one — it tracks audience size just as well.
		ratingCount: media.popularity ?? undefined,
		popularity: media.popularity ?? media.favourites ?? undefined,
		imageUrl: media.coverImage?.large,
		thumbnailUrl: media.coverImage?.medium ?? media.coverImage?.large,
		description: stripHtml(media.description),
		tags: media.genres ?? [],
		people: [...studios, ...staff],
		externalUrl: media.siteUrl,
		releaseDate: isoDate(media.startDate),
		extra: {
			format: media.format,
			status: media.status,
			episodes: media.episodes ?? undefined,
			chapters: media.chapters ?? undefined,
			volumes: media.volumes ?? undefined,
			runtime: media.duration ?? undefined,
			studios,
			staff,
			native_title: media.title?.native,
		},
	};
}

const FIELDS: FieldSchema = [
	{ name: "format", type: "string", description: "TV, MOVIE, MANGA…" },
	{ name: "status", type: "string", description: "Releasing, finished…" },
	{ name: "episodes", type: "number", description: "Episode count" },
	{ name: "chapters", type: "number", description: "Chapter count (manga)" },
	{ name: "volumes", type: "number", description: "Volume count (manga)" },
	{ name: "runtime", type: "number", description: "Episode duration, minutes" },
	{ name: "studios", type: "list", description: "Main studios" },
	{ name: "staff", type: "list", description: "Key staff" },
	{ name: "native_title", type: "string", description: "Title in native script" },
];

/**
 * AniList's genre vocabulary is closed and short, and `genre_in` silently
 * matches nothing for a name outside it — so a taste profile learned from films
 * has to be translated rather than passed through, and anything with no anime
 * equivalent is dropped instead of guessed at.
 */
const ANILIST_GENRES = [
	"Action",
	"Adventure",
	"Comedy",
	"Drama",
	"Ecchi",
	"Fantasy",
	"Horror",
	"Mahou Shoujo",
	"Mecha",
	"Music",
	"Mystery",
	"Psychological",
	"Romance",
	"Sci-Fi",
	"Slice of Life",
	"Sports",
	"Supernatural",
	"Thriller",
];

const GENRE_ALIASES: Record<string, string> = {
	"science fiction": "Sci-Fi",
	"sci-fi & fantasy": "Sci-Fi",
	scifi: "Sci-Fi",
	"action & adventure": "Action",
	crime: "Thriller",
	war: "Action",
	"war & politics": "Drama",
	documentary: "Slice of Life",
	family: "Slice of Life",
	kids: "Comedy",
};

function aniListGenres(names: readonly string[]): string[] {
	const known = new Map(ANILIST_GENRES.map((g) => [g.toLowerCase(), g]));
	const out: string[] = [];
	for (const raw of names) {
		const key = raw.trim().toLowerCase();
		const hit = known.get(key) ?? GENRE_ALIASES[key];
		if (hit && !out.includes(hit)) out.push(hit);
	}
	return out.slice(0, 3);
}

export class AniListProvider
	implements
		MediaProvider,
		Searchable,
		Resolvable,
		Recommendable,
		Discoverable,
		Enrichable
{
	readonly id = "anilist";
	readonly name = "AniList (anime & manga)";
	readonly kinds: readonly MediaKind[] = ["anime", "manga"];
	readonly fields = FIELDS;

	constructor(private readonly ctx: ProviderContext) {}

	/** Keyless, so it is always ready to use. */
	isConfigured(): boolean {
		return true;
	}

	settingsSchema(): readonly SettingDescriptor[] {
		return [
			{
				type: "dropdown",
				key: "preferredTitle",
				name: "Preferred title language",
				desc: "Which title to use for the note name.",
				default: "english",
				options: {
					english: "English",
					romaji: "Romaji",
					native: "Native",
				},
			},
		];
	}

	async search(query: string, ctx: RequestContext): Promise<MediaItem[]> {
		const trimmed = query.trim();
		if (!trimmed) return [];

		const type =
			ctx.kind === "manga" ? "MANGA" : ctx.kind === "anime" ? "ANIME" : null;

		const response = await this.ctx.http.postJson<
			GraphQLResponse<{ Page?: { media?: AniListMedia[] } }>
		>(
			ENDPOINT,
			{ query: SEARCH_QUERY, variables: { search: trimmed, type } },
			{ signal: ctx.signal, cacheTtlMs: 5 * 60 * 1000 },
		);

		// GraphQL reports failures in the body with a 200 status.
		if (response.errors?.length) {
			throw new Error(response.errors[0]?.message ?? "AniList query failed");
		}

		return (response.data?.Page?.media ?? []).map((m) =>
			this.applyTitlePreference(toItem(m), m),
		);
	}

	/** What AniList's own readers recommend to people who liked this one. */
	async similar(ref: MediaRef, ctx: RequestContext): Promise<MediaItem[]> {
		const id = Number(ref.id);
		if (!Number.isFinite(id)) return [];

		const response = await this.ctx.http.postJson<
			GraphQLResponse<{
				Media?: {
					recommendations?: {
						nodes?: { mediaRecommendation?: AniListMedia | null }[];
					};
				};
			}>
		>(
			ENDPOINT,
			{ query: SIMILAR_QUERY, variables: { id } },
			{ signal: ctx.signal, cacheTtlMs: 24 * 60 * 60 * 1000 },
		);

		if (response.errors?.length) {
			throw new Error(response.errors[0]?.message ?? "AniList query failed");
		}

		return (response.data?.Media?.recommendations?.nodes ?? [])
			.map((node) => node.mediaRecommendation)
			.filter((media): media is AniListMedia => Boolean(media))
			.map((media) => this.applyTitlePreference(toItem(media), media));
	}

	/**
	 * The tags, the studio, the staff, and what this belongs with.
	 *
	 * Tags are filtered on rank and on spoilers. A tag ranked 20 applies to the
	 * title the way "contains a chair" applies to a film, and a spoiler tag is
	 * one nobody wants a recommendation to be quietly built out of.
	 */
	async traits(
		ref: MediaRef,
		ctx: RequestContext,
	): Promise<ProviderTraits | null> {
		const id = Number(ref.id);
		if (!Number.isFinite(id)) return null;

		const response = await this.ctx.http.postJson<
			GraphQLResponse<{ Media?: AniListTraits }>
		>(
			ENDPOINT,
			{ query: TRAITS_QUERY, variables: { id } },
			{ signal: ctx.signal, cacheTtlMs: 7 * 24 * 60 * 60 * 1000 },
		);
		if (response.errors?.length) {
			throw new Error(response.errors[0]?.message ?? "AniList query failed");
		}

		const media = response.data?.Media;
		if (!media) return null;

		const kindOf = (type?: string): MediaKind =>
			type === "MANGA" ? "manga" : "anime";

		return {
			keywords: (media.tags ?? [])
				.filter((tag) => !tag.isMediaSpoiler && (tag.rank ?? 0) >= 60)
				.slice(0, 12)
				.map((tag) => ({ name: tag.name })),
			people: (media.characters?.nodes ?? [])
				.map((one) => one.name?.full)
				.filter((name): name is string => Boolean(name))
				.map((name) => ({ name })),
			directors: (media.staff?.nodes ?? [])
				.map((one) => one.name?.full)
				.filter((name): name is string => Boolean(name))
				.slice(0, 3)
				.map((name) => ({ name })),
			studios: (media.studios?.nodes ?? []).slice(0, 2).map((one) => one.name),
			...(media.countryOfOrigin ? { language: media.countryOfOrigin } : {}),
			...(media.duration ? { runtime: media.duration } : {}),
			related: (media.relations?.edges ?? [])
				.filter((edge) => RELATED_KINDS.has(edge.relationType ?? ""))
				.slice(0, 8)
				.map((edge) => ({
					providerId: "anilist",
					kind: kindOf(edge.node?.type),
					id: String(edge.node?.id),
				})),
		};
	}

	async discover(
		query: DiscoverQuery,
		ctx: RequestContext,
	): Promise<MediaItem[]> {
		const genres = aniListGenres(query.genres ?? []);
		// `genre_in` and `tag_in` together are an AND, and asking for a genre
		// *and* three specific tags returns somewhere between nothing and two
		// results. So it is one or the other, and tags win when there are any:
		// AniList's tags say far more about a title than its eighteen genres do.
		const tags = (query.keywords ?? []).slice(0, 3).map((one) => one.name);
		const byTag = tags.length > 0;

		const response = await this.ctx.http.postJson<
			GraphQLResponse<{ Page?: { media?: AniListMedia[] } }>
		>(
			ENDPOINT,
			{
				query: DISCOVER_QUERY,
				variables: {
					type: query.kind === "manga" ? "MANGA" : "ANIME",
					genres: !byTag && genres.length > 0 ? genres : null,
					tags: byTag ? tags : null,
					// AniList scores out of a hundred, Scout asks out of ten.
					score:
						query.minRating !== undefined
							? Math.round(query.minRating * 10)
							: 65,
					// FuzzyDateInt is `yyyymmdd` with zeroes for the unknown parts.
					year:
						query.fromYear !== undefined
							? query.fromYear * 10000
							: null,
					page: Math.max(1, query.page ?? 1),
				},
			},
			{ signal: ctx.signal, cacheTtlMs: 12 * 60 * 60 * 1000 },
		);

		if (response.errors?.length) {
			throw new Error(response.errors[0]?.message ?? "AniList query failed");
		}
		return (response.data?.Page?.media ?? []).map((m) =>
			this.applyTitlePreference(toItem(m), m),
		);
	}

	canResolve(url: string): boolean {
		return /anilist\.co\/(anime|manga)\/\d+/.test(url);
	}

	async resolve(url: string, ctx: RequestContext): Promise<MediaItem> {
		const match = /anilist\.co\/(?:anime|manga)\/(\d+)/.exec(url);
		if (!match?.[1]) throw new Error("Not an AniList URL");

		const response = await this.ctx.http.postJson<
			GraphQLResponse<{ Media?: AniListMedia }>
		>(
			ENDPOINT,
			{ query: BY_ID_QUERY, variables: { id: Number(match[1]) } },
			{ signal: ctx.signal, cacheTtlMs: 30 * 60 * 1000 },
		);

		if (response.errors?.length) {
			throw new Error(response.errors[0]?.message ?? "AniList query failed");
		}
		const media = response.data?.Media;
		if (!media) throw new Error("AniList returned no media for that URL");
		return this.applyTitlePreference(toItem(media), media);
	}

	private applyTitlePreference(
		item: MediaItem,
		media: AniListMedia,
	): MediaItem {
		// Explicit type parameter: without it the default narrows to the literal
		// "english" and the comparisons below become unreachable.
		const preference = this.ctx.settings.get<string>(
			"preferredTitle",
			"english",
		);
		const chosen =
			preference === "romaji"
				? media.title?.romaji
				: preference === "native"
					? media.title?.native
					: media.title?.english;
		return chosen ? { ...item, title: chosen } : item;
	}
}
