import type { MediaKind } from "../../core/types";

/**
 * TMDB's genre vocabulary, held here rather than fetched.
 *
 * It is a fixed list of about thirty names that has changed twice in a decade,
 * and having it locally matters more than it looks: TMDB's *list* endpoints —
 * search, recommendations, discover — return `genre_ids` and never the names,
 * while only the per-title detail endpoint returns `genres`. Without this map
 * every search result and every recommendation arrived with an empty `tags`
 * array, so anything ranking on genre was ranking on nothing.
 */

/** Movie ids and TV ids share a namespace; the eight overlapping ones agree. */
const NAMES: Record<number, string> = {
	28: "Action",
	12: "Adventure",
	16: "Animation",
	35: "Comedy",
	80: "Crime",
	99: "Documentary",
	18: "Drama",
	10751: "Family",
	14: "Fantasy",
	36: "History",
	27: "Horror",
	10402: "Music",
	9648: "Mystery",
	10749: "Romance",
	878: "Science Fiction",
	10770: "TV Movie",
	53: "Thriller",
	10752: "War",
	37: "Western",
	// TV-only.
	10759: "Action & Adventure",
	10762: "Kids",
	10763: "News",
	10764: "Reality",
	10765: "Sci-Fi & Fantasy",
	10766: "Soap",
	10767: "Talk",
	10768: "War & Politics",
};

export function genreNames(ids: readonly number[] | undefined): string[] {
	if (!ids) return [];
	const out: string[] = [];
	for (const id of ids) {
		const name = NAMES[id];
		if (name && !out.includes(name)) out.push(name);
	}
	return out;
}

/**
 * The reverse, per kind — and the reason it is not one map inverted.
 *
 * TMDB splits genres the two catalogues do not agree on: films have Science
 * Fiction and Fantasy as separate genres, television has one "Sci-Fi & Fantasy"
 * covering both, and neither id is accepted by the other endpoint. Somebody
 * whose taste was learned from a shelf of TV asking for films would otherwise
 * match nothing at all, so the names either side translate.
 */
const MOVIE_ALIASES: Record<string, number[]> = {
	"sci-fi & fantasy": [878, 14],
	"action & adventure": [28, 12],
	"war & politics": [10752],
	"sci-fi": [878],
	"science-fiction": [878],
	kids: [10751],
	reality: [99],
};

const TV_ALIASES: Record<string, number[]> = {
	"science fiction": [10765],
	"sci-fi": [10765],
	fantasy: [10765],
	action: [10759],
	adventure: [10759],
	war: [10768],
	thriller: [9648],
	horror: [9648],
	romance: [18],
	history: [99],
	music: [10764],
};

const BY_NAME = new Map<string, number>();
for (const [id, name] of Object.entries(NAMES)) {
	BY_NAME.set(name.toLowerCase(), Number(id));
}

/** Ids the discover endpoint for `kind` will actually accept, in the order given. */
export function genreIds(
	names: readonly string[],
	kind: MediaKind,
): number[] {
	const tv = kind === "tv";
	const aliases = tv ? TV_ALIASES : MOVIE_ALIASES;
	const out: number[] = [];

	const push = (id: number) => {
		if (!valid(id, tv) || out.includes(id)) return;
		out.push(id);
	};

	for (const raw of names) {
		const key = raw.trim().toLowerCase();
		if (!key) continue;
		const direct = BY_NAME.get(key);
		// The alias only stands in when the literal name is wrong for this
		// catalogue — "Animation" is 16 on both and needs no translating.
		if (direct !== undefined && valid(direct, tv)) {
			push(direct);
			continue;
		}
		for (const id of aliases[key] ?? []) push(id);
	}
	return out;
}

/** Ids the TV endpoint rejects, and the ones the movie endpoint rejects. */
const TV_ONLY = new Set([10759, 10762, 10763, 10764, 10765, 10766, 10767, 10768]);
const MOVIE_ONLY = new Set([28, 12, 14, 36, 27, 10402, 10749, 878, 10770, 53, 10752]);

function valid(id: number, tv: boolean): boolean {
	return tv ? !MOVIE_ONLY.has(id) : !TV_ONLY.has(id);
}
