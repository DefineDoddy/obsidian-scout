/* obsidian-scout\src\ui\utils\tvUtils.ts
   Compact, typed helpers for TV/Movie search and templating.
   - separated from UI
   - no 'any' / 'unknown' in public helpers
   - added getPosterUrlFromResult for convenience
*/

import {
	MovieWithMediaType,
	TVWithMediaType,
	MovieDetails,
	TvShowDetails,
} from "tmdb-ts";

/* Public types */
export type SearchResult = MovieWithMediaType | TVWithMediaType;

export interface TemplateData {
	title: string;
	rating: number;
	overview?: string;
	runtime?: number;
	genres: string;
	poster: string;
	type: "movie" | "tv";
	release_date?: string;
	id: number;
	now: string; // YYYY-MM-DD
}

/* Type guards */
export const isMovieResult = (r: SearchResult): r is MovieWithMediaType =>
	r.media_type === "movie";

/* Small pure helpers */
export const roundTo1dp = (n?: number): number =>
	Math.round((n ?? 0) * 10) / 10;

export const getTitleFromResult = (r: SearchResult): string =>
	("title" in r && r.title) || ("name" in r && r.name) || "Untitled";

export const getYearFromResult = (r: SearchResult): number | undefined => {
	const date =
		("release_date" in r && r.release_date) ||
		("first_air_date" in r && r.first_air_date);
	if (!date) return undefined;
	const y = parseInt(date.slice(0, 4), 10);
	return Number.isNaN(y) ? undefined : y;
};

export const getPosterUrl = (path?: string | null, size = "w500"): string =>
	path ? `https://image.tmdb.org/t/p/${size}${path}` : "";

export const getPosterUrlFromResult = (
	r: SearchResult,
	size = "w500",
): string =>
	"poster_path" in r && r.poster_path
		? getPosterUrl(r.poster_path, size)
		: "";

export const getGenres = (d: MovieDetails | TvShowDetails): string =>
	Array.isArray(d.genres)
		? d.genres
				.map((g) => g.name)
				.filter(Boolean)
				.join(", ")
		: "";

export const getVoteAverageFromResult = (
	r: SearchResult,
): number | undefined =>
	typeof r.vote_average === "number" ? r.vote_average : undefined;

/* Build TemplateData from details + search result (keeps logic compact) */
export const buildTemplateData = (
	details: MovieDetails | TvShowDetails,
	result: SearchResult,
): TemplateData => {
	const title =
		("title" in details && details.title) ||
		("name" in details && (details as TvShowDetails).name) ||
		getTitleFromResult(result);

	const rawRating =
		typeof details.vote_average === "number"
			? details.vote_average
			: undefined;

	const runtime =
		typeof (details as MovieDetails).runtime === "number"
			? (details as MovieDetails).runtime
			: Array.isArray((details as TvShowDetails).episode_run_time) &&
				  (details as TvShowDetails).episode_run_time.length > 0
				? (details as TvShowDetails).episode_run_time[0]
				: undefined;

	const release_date =
		("release_date" in details && details.release_date) ||
		("first_air_date" in details &&
			(details as TvShowDetails).first_air_date) ||
		undefined;

	const poster =
		"poster_path" in details && details.poster_path
			? getPosterUrl(details.poster_path)
			: "";

	return {
		title: String(title),
		rating: roundTo1dp(rawRating),
		overview:
			typeof details.overview === "string" ? details.overview : undefined,
		runtime,
		genres: getGenres(details),
		poster,
		type: result.media_type === "tv" ? "tv" : "movie",
		release_date,
		id: typeof result.id === "number" ? result.id : Number(result.id),
		now: new Date().toISOString().split("T")[0],
	};
};

/* Replace placeholders like {{title}} in template (deterministic, no regex required) */
export const replacePlaceholders = (
	template: string,
	data: TemplateData,
): string => {
	let out = template;
	(Object.keys(data) as Array<keyof TemplateData>).forEach((k) => {
		const v = data[k];
		const replacement = typeof v === "number" ? String(v) : (v ?? "");
		out = out.split(`{{${String(k)}}}`).join(replacement);
	});
	return out;
};
