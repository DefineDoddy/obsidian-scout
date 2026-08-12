import type {
	SeriesAware,
	Detailable,
	Discoverable,
	DiscoverQuery,
	Enrichable,
	Episodic,
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
	Series,
	EpisodeInfo,
	FieldSchema,
	MediaItem,
	MediaKind,
	MediaRef,
	SeasonInfo,
} from "../../core/types";
import { genreIds, genreNames } from "./genres";

/**
 * TMDB (movies and TV).
 *
 * Talks to the REST API directly through the shared HttpClient rather than via
 * `tmdb-ts`, because that library calls `cross-fetch` — which bypasses
 * Obsidian's `requestUrl`, so it is subject to webview CORS and cannot be
 * cached, retried, or cancelled centrally. Only three endpoints are needed.
 */

const API = "https://api.themoviedb.org/3";
const IMAGE = "https://image.tmdb.org/t/p";

const NO_POSTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750" viewBox="0 0 500 750"><rect fill="#e6e6e6" width="100%" height="100%"/><g fill="#9b9b9b" font-family="system-ui, sans-serif" font-weight="600"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="48">No Image</text></g></svg>`;
export const NO_POSTER = `data:image/svg+xml;utf8,${encodeURIComponent(NO_POSTER_SVG)}`;

/* --------------------------------------------------------- response shapes */

interface TmdbSearchItem {
	id: number;
	media_type?: string;
	title?: string;
	name?: string;
	original_title?: string;
	original_name?: string;
	overview?: string;
	poster_path?: string | null;
	release_date?: string;
	first_air_date?: string;
	vote_average?: number;
	vote_count?: number;
	popularity?: number;
	genre_ids?: number[];
}

interface TmdbSeason {
	season_number: number;
	name?: string;
	episode_count?: number;
	air_date?: string;
	overview?: string;
	poster_path?: string | null;
}

interface TmdbEpisode {
	season_number?: number;
	episode_number: number;
	name?: string;
	overview?: string;
	air_date?: string;
	vote_average?: number;
	runtime?: number;
	still_path?: string | null;
}

interface TmdbDetails extends TmdbSearchItem {
	genres?: { id: number; name: string }[];
	runtime?: number;
	episode_run_time?: number[];
	number_of_seasons?: number;
	number_of_episodes?: number;
	seasons?: TmdbSeason[];
	belongs_to_collection?: { id: number; name?: string } | null;
	status?: string;
	tagline?: string;
	original_language?: string;
	production_companies?: { id: number; name: string }[];
	credits?: {
		cast?: { id?: number; name: string }[];
		crew?: { id?: number; name: string; job: string }[];
	};
	/**
	 * Films answer under `keywords`, television under `results`. One field name
	 * would have been nice, and TMDB is not going to change it now.
	 */
	keywords?: {
		keywords?: { id: number; name: string }[];
		results?: { id: number; name: string }[];
	};
}

/* ------------------------------------------------------------------ mapping */

function posterUrl(path: string | null | undefined, size: string): string {
	return path ? `${IMAGE}/${size}${path}` : NO_POSTER;
}

/**
 * The same, without the placeholder.
 *
 * A missing episode still should collapse to nothing — a row of "No Image"
 * cards down a season list is worse than a row with no images at all.
 */
function image(
	path: string | null | undefined,
	size: string,
): string | undefined {
	return path ? `${IMAGE}/${size}${path}` : undefined;
}

function yearOf(date: string | undefined): number | undefined {
	if (!date) return undefined;
	const year = Number.parseInt(date.slice(0, 4), 10);
	return Number.isNaN(year) ? undefined : year;
}

function kindOf(raw: TmdbSearchItem, fallback: MediaKind): MediaKind {
	if (raw.media_type === "movie") return "movie";
	if (raw.media_type === "tv") return "tv";
	return fallback;
}

/** Search results carry only a subset of fields; details fills in the rest. */
function toItem(raw: TmdbDetails, kind: MediaKind): MediaItem {
	const title = raw.title ?? raw.name ?? "Untitled";
	const date = raw.release_date ?? raw.first_air_date;
	const runtime =
		typeof raw.runtime === "number" ? raw.runtime : raw.episode_run_time?.[0];

	const directors =
		raw.credits?.crew
			?.filter((c) => c.job === "Director")
			.map((c) => c.name) ?? [];
	const cast = raw.credits?.cast?.slice(0, 10).map((c) => c.name) ?? [];

	return {
		ref: { providerId: "tmdb", kind, id: String(raw.id) },
		title,
		subtitle: raw.original_title ?? raw.original_name,
		year: yearOf(date),
		rating:
			typeof raw.vote_average === "number"
				? Math.round(raw.vote_average * 10) / 10
				: undefined,
		ratingCount: raw.vote_count,
		popularity: raw.popularity,
		imageUrl: posterUrl(raw.poster_path, "w500"),
		thumbnailUrl: posterUrl(raw.poster_path, "w185"),
		description: raw.overview || undefined,
		// Detail responses name the genres; every list response only numbers
		// them, and a suggestion with no genres cannot be ranked on genre.
		tags: raw.genres?.map((g) => g.name) ?? genreNames(raw.genre_ids),
		people: [...directors, ...cast],
		externalUrl: `https://www.themoviedb.org/${kind}/${raw.id}`,
		releaseDate: date || undefined,
		extra: {
			runtime,
			tagline: raw.tagline,
			status: raw.status,
			number_of_seasons: raw.number_of_seasons,
			number_of_episodes: raw.number_of_episodes,
			series: raw.belongs_to_collection?.name,
			// Carried so the detail view can tell "not in a series" from "not
			// asked yet", and skip the request entirely for the former.
			series_id: raw.belongs_to_collection
				? String(raw.belongs_to_collection.id)
				: undefined,
			// TMDB's own word for a film series, and the name these two fields
			// went by before Scout's own collections took it. Kept so templates
			// and cached records written then still resolve.
			collection: raw.belongs_to_collection?.name,
			collection_id: raw.belongs_to_collection
				? String(raw.belongs_to_collection.id)
				: undefined,
			directors,
			cast,
			// Kept for templates that still reference the pre-refactor names.
			overview: raw.overview,
			type: kind,
		},
	};
}

/* ----------------------------------------------------------------- provider */

const FIELDS: FieldSchema = [
	{ name: "runtime", type: "number", description: "Runtime in minutes" },
	{ name: "tagline", type: "string", description: "Marketing tagline" },
	{ name: "status", type: "string", description: "Released, Returning Series…" },
	{ name: "number_of_seasons", type: "number", description: "TV seasons" },
	{ name: "number_of_episodes", type: "number", description: "TV episodes" },
	{
		name: "series",
		type: "string",
		description: "Film series the film belongs to",
	},
	{
		name: "collection",
		type: "string",
		description: "Alias of series, under TMDB's own name for it",
	},
	{ name: "directors", type: "list", description: "Directors" },
	{ name: "cast", type: "list", description: "Top-billed cast" },
	{ name: "overview", type: "string", description: "Alias of description" },
];

export class TmdbProvider
	implements
		MediaProvider,
		Searchable,
		Detailable,
		Resolvable,
		Episodic,
		SeriesAware,
		Recommendable,
		Discoverable,
		Enrichable
{
	readonly id = "tmdb";
	readonly name = "TMDB (movies & TV)";
	readonly kinds: readonly MediaKind[] = ["movie", "tv"];
	readonly fields = FIELDS;

	constructor(private readonly ctx: ProviderContext) {}

	isConfigured(): boolean {
		return this.token().length > 0;
	}

	settingsSchema(): readonly SettingDescriptor[] {
		return [
			{
				type: "text",
				key: "accessToken",
				name: "API read access token",
				desc: "From your TMDB account under Settings → API. Stored in plain text in this vault's plugin data.",
				default: "",
				placeholder: "eyJhbGciOi…",
				secret: true,
			},
			{
				type: "toggle",
				key: "includeCredits",
				name: "Fetch cast and crew",
				desc: "Adds {{directors}} and {{cast}}. Costs one extra request per note.",
				default: true,
			},
		];
	}

	async search(query: string, ctx: RequestContext): Promise<MediaItem[]> {
		const trimmed = query.trim();
		if (!trimmed) return [];

		// A specific kind uses the narrower endpoint; otherwise multi-search.
		const endpoint =
			ctx.kind === "movie"
				? "search/movie"
				: ctx.kind === "tv"
					? "search/tv"
					: "search/multi";

		const response = await this.ctx.http.getJson<{
			results?: TmdbSearchItem[];
		}>(`${API}/${endpoint}?query=${encodeURIComponent(trimmed)}`, {
			headers: this.headers(),
			signal: ctx.signal,
			cacheTtlMs: 5 * 60 * 1000,
		});

		const fallback: MediaKind = ctx.kind === "tv" ? "tv" : "movie";
		return (response.results ?? [])
			.filter(
				(r) =>
					ctx.kind !== undefined ||
					r.media_type === "movie" ||
					r.media_type === "tv",
			)
			.slice(0, 20)
			.map((r) => toItem(r, kindOf(r, fallback)));
	}

	/**
	 * Everything about one title, in one request.
	 *
	 * The appended sections are chosen so that `details` and `traits` build the
	 * *same URL* — one cache key, so the refresher asking about a note and the
	 * enricher reading up on it cost one request between them rather than two.
	 */
	private detailUrl(ref: MediaRef): string {
		const path = ref.kind === "tv" ? "tv" : "movie";
		const append: string[] = [];
		if (this.ctx.settings.get("includeCredits", true)) append.push("credits");
		if (this.ctx.settings.get("enrichSuggestions", true)) append.push("keywords");
		const query = append.length > 0 ? `?append_to_response=${append.join(",")}` : "";
		return `${API}/${path}/${ref.id}${query}`;
	}

	async details(ref: MediaRef, ctx: RequestContext): Promise<MediaItem> {
		const raw = await this.ctx.http.getJson<TmdbDetails>(this.detailUrl(ref), {
			headers: this.headers(),
			signal: ctx.signal,
			cacheTtlMs: 30 * 60 * 1000,
		});
		return toItem(raw, ref.kind);
	}

	/**
	 * What a note never records: the keywords, the billed cast, the crew.
	 *
	 * Keywords are the reason this exists. "Drama, Thriller" is shared by a
	 * third of everything ever made; "time loop", "heist", "coming of age" are
	 * what actually tell two films apart, and TMDB has them for nearly
	 * everything. Ids are kept alongside the names because `with_keywords` and
	 * `with_crew` take ids — a name that arrived without one can be learned
	 * from but never asked about.
	 */
	async traits(
		ref: MediaRef,
		ctx: RequestContext,
	): Promise<ProviderTraits | null> {
		const raw = await this.ctx.http.getJson<TmdbDetails>(this.detailUrl(ref), {
			headers: this.headers(),
			signal: ctx.signal,
			cacheTtlMs: 30 * 60 * 1000,
		});

		// Movies answer `keywords.keywords`; television answers `keywords.results`.
		// One field name would have been nice.
		const words = raw.keywords?.keywords ?? raw.keywords?.results ?? [];
		const crew = raw.credits?.crew ?? [];
		const named = (job: string) => crew.filter((one) => one.job === job);

		const runtime =
			typeof raw.runtime === "number" ? raw.runtime : raw.episode_run_time?.[0];

		return {
			keywords: words.map((one) => ({ name: one.name, id: String(one.id) })),
			people: (raw.credits?.cast ?? [])
				.slice(0, 8)
				.map((one) => ({ name: one.name, id: String(one.id) })),
			directors: [...named("Director"), ...named("Creator")]
				.slice(0, 3)
				.map((one) => ({ name: one.name, id: String(one.id) })),
			studios: (raw.production_companies ?? [])
				.slice(0, 2)
				.map((one) => one.name),
			...(raw.belongs_to_collection
				? {
						series: {
							id: `tmdb:${raw.belongs_to_collection.id}`,
							name: raw.belongs_to_collection.name ?? "the same series",
						},
					}
				: {}),
			...(raw.original_language ? { language: raw.original_language } : {}),
			...(runtime ? { runtime } : {}),
		};
	}

	/* ---------------------------------------------------------- episodes */

	/**
	 * The season list, which comes with the show itself — so this is the same
	 * request `details` makes and the cache serves it without going out again.
	 */
	async seasons(ref: MediaRef, ctx: RequestContext): Promise<SeasonInfo[]> {
		if (ref.kind !== "tv") return [];
		const raw = await this.ctx.http.getJson<TmdbDetails>(
			`${API}/tv/${ref.id}`,
			{
				headers: this.headers(),
				signal: ctx.signal,
				cacheTtlMs: 30 * 60 * 1000,
			},
		);
		return (raw.seasons ?? [])
			.filter((season) => (season.episode_count ?? 0) > 0)
			.map((season) => ({
				number: season.season_number,
				name: season.name || `Season ${season.season_number}`,
				episodeCount: season.episode_count,
				year: yearOf(season.air_date),
				overview: season.overview || undefined,
				posterUrl: image(season.poster_path, "w185"),
			}))
			.sort((a, b) => a.number - b.number);
	}

	async episodes(
		ref: MediaRef,
		season: number,
		ctx: RequestContext,
	): Promise<EpisodeInfo[]> {
		if (ref.kind !== "tv") return [];
		const raw = await this.ctx.http.getJson<{ episodes?: TmdbEpisode[] }>(
			`${API}/tv/${ref.id}/season/${season}`,
			{
				headers: this.headers(),
				signal: ctx.signal,
				cacheTtlMs: 30 * 60 * 1000,
			},
		);
		return (raw.episodes ?? []).map((episode) => ({
			season: episode.season_number ?? season,
			number: episode.episode_number,
			title: episode.name || `Episode ${episode.episode_number}`,
			overview: episode.overview || undefined,
			airDate: episode.air_date || undefined,
			// Zero is nobody having voted, not a verdict — the same thing the
			// cards guard against on an unreleased item.
			rating:
				typeof episode.vote_average === "number" &&
				episode.vote_average > 0
					? Math.round(episode.vote_average * 10) / 10
					: undefined,
			runtime: episode.runtime,
			stillUrl: image(episode.still_path, "w300"),
		}));
	}

	/* ------------------------------------------------------------- series */

	/** The film series a film belongs to, in release order. */
	async series(
		ref: MediaRef,
		ctx: RequestContext,
	): Promise<Series | null> {
		if (ref.kind !== "movie") return null;

		// The caller usually has the record already, and it carries the series
		// id — which saves fetching the film a second time to read one field.
		const hint =
			ctx.previous?.extra?.series_id ?? ctx.previous?.extra?.collection_id;
		let id = typeof hint === "string" || typeof hint === "number" ? String(hint) : null;

		if (id === null) {
			const movie = await this.ctx.http.getJson<TmdbDetails>(
				`${API}/movie/${ref.id}`,
				{
					headers: this.headers(),
					signal: ctx.signal,
					cacheTtlMs: 30 * 60 * 1000,
				},
			);
			if (!movie.belongs_to_collection) return null;
			id = String(movie.belongs_to_collection.id);
		}

		const raw = await this.ctx.http.getJson<{
			id: number;
			name?: string;
			overview?: string;
			parts?: TmdbSearchItem[];
		}>(`${API}/collection/${id}`, {
			headers: this.headers(),
			signal: ctx.signal,
			cacheTtlMs: 24 * 60 * 60 * 1000,
		});

		return {
			id: String(raw.id ?? id),
			name: raw.name ?? "Series",
			overview: raw.overview || undefined,
			items: (raw.parts ?? [])
				.map((part) => toItem(part, "movie"))
				// Release order, which is the order a series is meant in.
				.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999)),
		};
	}

	/* ---------------------------------------------------- recommendations */

	/**
	 * What TMDB thinks goes with this one.
	 *
	 * Their `recommendations` endpoint rather than `similar`: the first is built
	 * from what people who watched this went on to watch, the second from
	 * matching genres and keywords — and the second is a worse version of
	 * something Scout already does for itself out of your own library.
	 *
	 * Cached for a day. What is like Arrival does not change hourly, and the
	 * hub asks about several titles each time it opens.
	 */
	async similar(ref: MediaRef, ctx: RequestContext): Promise<MediaItem[]> {
		const path = ref.kind === "tv" ? "tv" : "movie";
		const raw = await this.ctx.http.getJson<{ results?: TmdbSearchItem[] }>(
			`${API}/${path}/${ref.id}/recommendations`,
			{
				headers: this.headers(),
				signal: ctx.signal,
				cacheTtlMs: 24 * 60 * 60 * 1000,
			},
		);
		return (raw.results ?? [])
			.slice(0, 20)
			.map((item) => toItem(item, kindOf(item, ref.kind)));
	}

	/**
	 * The catalogue itself, filtered.
	 *
	 * Sorted by vote count rather than by score, with a floor under the count:
	 * `vote_average.desc` on TMDB returns a wall of films with a 10.0 from four
	 * people, which is not a list of good films, it is a list of small samples.
	 * Ordering by how many have voted and letting Scout's own ranking sort the
	 * result gives a pool of things that are genuinely well known to be good.
	 */
	async discover(
		query: DiscoverQuery,
		ctx: RequestContext,
	): Promise<MediaItem[]> {
		const kind: MediaKind = query.kind === "tv" ? "tv" : "movie";
		const path = kind === "tv" ? "tv" : "movie";

		// `rated` needs a much higher floor than the default, or it returns the
		// same wall of four-vote tens that `vote_average.desc` always does.
		const sort =
			query.sort === "rated"
				? { sort_by: "vote_average.desc", "vote_count.gte": "1000" }
				: query.sort === "recent"
					? { sort_by: "primary_release_date.desc", "vote_count.gte": "200" }
					: { sort_by: "vote_count.desc", "vote_count.gte": "300" };

		const params = new URLSearchParams({
			...sort,
			include_adult: "false",
			page: String(Math.max(1, query.page ?? 1)),
		});

		// Only terms that arrived with an id can be asked about: TMDB filters on
		// keyword and person ids, and a name it never gave us an id for is
		// something the model can learn from but not go looking with.
		const ids = (terms: readonly { id?: string }[] | undefined, most: number) =>
			(terms ?? [])
				.map((one) => one.id)
				.filter((id): id is string => Boolean(id))
				.slice(0, most);

		// OR, like the genres below and for the same reason.
		const keywords = ids(query.keywords, 3);
		if (keywords.length > 0) params.set("with_keywords", keywords.join("|"));

		const notKeywords = ids(query.withoutKeywords, 3);
		if (notKeywords.length > 0) {
			params.set("without_keywords", notKeywords.join(","));
		}

		// Crew rather than cast wherever there is a choice. `with_people` matches
		// any credit at all, including a single scene, and returns a great deal
		// of noise; a director is the query actually worth building on.
		const crew = ids(query.crew, 2);
		if (crew.length > 0) params.set("with_crew", crew.join("|"));

		const cast = ids(query.people, 2);
		if (cast.length > 0) params.set("with_people", cast.join("|"));

		const wanted = genreIds(query.genres ?? [], kind).slice(0, 3);
		// OR rather than AND: three genres joined by commas asks for titles that
		// are all three at once, which on any real taste profile is a handful of
		// films and usually none.
		if (wanted.length > 0) params.set("with_genres", wanted.join("|"));

		const avoid = genreIds(query.without ?? [], kind).filter(
			(id) => !wanted.includes(id),
		);
		if (avoid.length > 0) params.set("without_genres", avoid.join(","));

		if (query.minRating !== undefined) {
			params.set("vote_average.gte", String(query.minRating));
		}
		if (query.fromYear !== undefined) {
			params.set(
				kind === "tv"
					? "first_air_date.gte"
					: "primary_release_date.gte",
				`${query.fromYear}-01-01`,
			);
		}

		const raw = await this.ctx.http.getJson<{ results?: TmdbSearchItem[] }>(
			`${API}/discover/${path}?${params.toString()}`,
			{
				headers: this.headers(),
				signal: ctx.signal,
				cacheTtlMs: 12 * 60 * 60 * 1000,
			},
		);
		return (raw.results ?? []).map((item) => toItem(item, kind));
	}

	canResolve(url: string): boolean {
		return /themoviedb\.org\/(movie|tv)\/\d+/.test(url);
	}

	async resolve(url: string, ctx: RequestContext): Promise<MediaItem> {
		const match = /themoviedb\.org\/(movie|tv)\/(\d+)/.exec(url);
		if (!match?.[1] || !match[2]) throw new Error("Not a TMDB URL");
		return this.details(
			{ providerId: this.id, kind: match[1] as MediaKind, id: match[2] },
			ctx,
		);
	}

	/** Genre list for the filter dropdown. Cached hard — it changes rarely. */
	async genres(ctx: RequestContext): Promise<{ id: number; name: string }[]> {
		const fetchList = (path: string) =>
			this.ctx.http.getJson<{ genres?: { id: number; name: string }[] }>(
				`${API}/genre/${path}/list`,
				{
					headers: this.headers(),
					signal: ctx.signal,
					cacheTtlMs: 24 * 60 * 60 * 1000,
				},
			);

		const [movie, tv] = await Promise.all([
			fetchList("movie"),
			fetchList("tv"),
		]);

		const byId = new Map<number, string>();
		for (const g of [...(movie.genres ?? []), ...(tv.genres ?? [])]) {
			if (!byId.has(g.id)) byId.set(g.id, g.name);
		}
		return [...byId.entries()]
			.map(([id, name]) => ({ id, name }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	private token(): string {
		return this.ctx.settings.get("accessToken", "").trim();
	}

	private headers(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.token()}`,
			Accept: "application/json",
		};
	}
}
