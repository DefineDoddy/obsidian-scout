import type {
	MovieWithMediaType,
	TVWithMediaType,
	MovieDetails,
	TvShowDetails,
} from "tmdb-ts";

export type SearchResult = MovieWithMediaType | TVWithMediaType;

export interface TemplateData {
	title: string;
	rating?: number;
	overview?: string;
	runtime?: number;
	genres: string;
	poster: string;
	type: "movie" | "tv";
	release_date?: string;
	id: number;
	now: string; // YYYY-MM-DD
}

export function isMovieResult(
	result: SearchResult,
): result is MovieWithMediaType {
	return result.media_type === "movie";
}

export function roundTo1dp(num?: number): number {
	return Math.round((num ?? 0) * 10) / 10;
}

export function getTitleFromResult(r: SearchResult): string {
	return ("title" in r && r.title) || ("name" in r && r.name) || "Untitled";
}

export function getYearFromResult(result: SearchResult): number | undefined {
	const date =
		("release_date" in result && result.release_date) ||
		("first_air_date" in result && result.first_air_date);

	if (!date) return undefined;
	const y = parseInt(date.slice(0, 4), 10);

	return Number.isNaN(y) ? undefined : y;
}

export function getPosterUrl(path?: string | null, size = "w500"): string {
	return path ? `https://image.tmdb.org/t/p/${size}${path}` : "";
}

export function getPosterUrlFromResult(
	result: SearchResult,
	size = "w500",
): string {
	return "poster_path" in result && result.poster_path
		? getPosterUrl(result.poster_path, size)
		: "";
}

export function getGenres(details: MovieDetails | TvShowDetails): string {
	return Array.isArray(details.genres)
		? details.genres
				.map((g) => g.name)
				.filter(Boolean)
				.join(", ")
		: "";
}

export function getVoteAverageFromResult(
	result: SearchResult,
): number | undefined {
	return typeof result.vote_average === "number" && result.vote_average > 0
		? result.vote_average
		: undefined;
}

export function buildTemplateData(
	details: MovieDetails | TvShowDetails,
	result: SearchResult,
): TemplateData {
	const title =
		("title" in details && details.title) ||
		("name" in details && (details as TvShowDetails).name) ||
		getTitleFromResult(result);

	const rawRating =
		typeof details.vote_average === "number" && details.vote_average > 0
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
		title,
		rating: rawRating !== undefined ? roundTo1dp(rawRating) : undefined,
		overview:
			typeof details.overview === "string" ? details.overview : undefined,
		runtime,
		genres: getGenres(details) || "Unknown",
		poster,
		type: result.media_type === "tv" ? "tv" : "movie",
		release_date: release_date || undefined,
		id: typeof result.id === "number" ? result.id : Number(result.id),
		now: new Date().toISOString().split("T")[0],
	};
}

export function replacePlaceholders(
	template: string,
	data: TemplateData,
): string {
	let out = template;

	(Object.keys(data) as Array<keyof TemplateData>).forEach((k) => {
		const v = data[k];
		const replacement =
			typeof v === "number" ? String(v) : (v ?? "Unknown");
		out = out.split(`{{${String(k)}}}`).join(replacement);
	});

	return out;
}
