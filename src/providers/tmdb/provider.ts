import type {
	Detailable,
	MediaProvider,
	ProviderContext,
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

interface TmdbDetails extends TmdbSearchItem {
	genres?: { id: number; name: string }[];
	runtime?: number;
	episode_run_time?: number[];
	number_of_seasons?: number;
	number_of_episodes?: number;
	status?: string;
	tagline?: string;
	credits?: {
		cast?: { name: string }[];
		crew?: { name: string; job: string }[];
	};
}

/* ------------------------------------------------------------------ mapping */

function posterUrl(path: string | null | undefined, size: string): string {
	return path ? `${IMAGE}/${size}${path}` : NO_POSTER;
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
		tags: raw.genres?.map((g) => g.name) ?? [],
		people: [...directors, ...cast],
		externalUrl: `https://www.themoviedb.org/${kind}/${raw.id}`,
		releaseDate: date || undefined,
		extra: {
			runtime,
			tagline: raw.tagline,
			status: raw.status,
			number_of_seasons: raw.number_of_seasons,
			number_of_episodes: raw.number_of_episodes,
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
	{ name: "directors", type: "list", description: "Directors" },
	{ name: "cast", type: "list", description: "Top-billed cast" },
	{ name: "overview", type: "string", description: "Alias of description" },
];

export class TmdbProvider
	implements MediaProvider, Searchable, Detailable, Resolvable
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

	async details(ref: MediaRef, ctx: RequestContext): Promise<MediaItem> {
		const path = ref.kind === "tv" ? "tv" : "movie";
		const wantCredits = this.ctx.settings.get("includeCredits", true);
		const append = wantCredits ? "?append_to_response=credits" : "";

		const raw = await this.ctx.http.getJson<TmdbDetails>(
			`${API}/${path}/${ref.id}${append}`,
			{
				headers: this.headers(),
				signal: ctx.signal,
				cacheTtlMs: 30 * 60 * 1000,
			},
		);
		return toItem(raw, ref.kind);
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
