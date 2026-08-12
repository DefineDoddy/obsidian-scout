import type {
	Detailable,
	Discoverable,
	DiscoverQuery,
	Enrichable,
	MediaProvider,
	ProviderContext,
	ProviderTraits,
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
 * Open Library.
 *
 * A structured, keyless JSON API, and the only book source. It replaced a
 * Goodreads scraper that parsed minified CSS class names and broke whenever
 * Goodreads redesigned.
 *
 * It also validates the provider abstraction against a non-TMDB shape: string
 * ids (`OL45804W`), authors instead of cast, ISBNs, page counts, and a rating
 * on a 5-point scale that needs normalizing to Scout's 0-10.
 */

const API = "https://openlibrary.org";
const COVERS = "https://covers.openlibrary.org/b/id";

const NO_COVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><rect fill="#e6e6e6" width="100%" height="100%"/><g fill="#9b9b9b" font-family="system-ui, sans-serif" font-weight="600"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="36">No Cover</text></g></svg>`;
export const NO_COVER = `data:image/svg+xml;utf8,${encodeURIComponent(NO_COVER_SVG)}`;

interface SearchDoc {
	key?: string;
	title?: string;
	subtitle?: string;
	author_name?: string[];
	first_publish_year?: number;
	cover_i?: number;
	subject?: string[];
	number_of_pages_median?: number;
	isbn?: string[];
	ratings_average?: number;
	ratings_count?: number;
	publisher?: string[];
	language?: string[];
	author_key?: string[];
}

interface WorkDetails {
	description?: string | { value?: string };
	subjects?: string[];
	covers?: number[];
}

function coverUrl(id: number | undefined, size: "M" | "L"): string {
	return id ? `${COVERS}/${id}-${size}.jpg` : NO_COVER;
}

/** `/works/OL45804W` → `OL45804W` */
function workId(key: string | undefined): string {
	return (key ?? "").replace(/^\/works\//, "");
}

function toItem(doc: SearchDoc): MediaItem {
	const authors = doc.author_name ?? [];
	const id = workId(doc.key);

	return {
		ref: { providerId: "openlibrary", kind: "book", id },
		title: doc.title ?? "Untitled",
		subtitle: doc.subtitle ?? authors[0],
		year: doc.first_publish_year,
		// Open Library rates out of 5; Scout normalizes every source to 0-10.
		rating:
			typeof doc.ratings_average === "number"
				? Math.round(doc.ratings_average * 2 * 10) / 10
				: undefined,
		ratingCount: doc.ratings_count,
		popularity: doc.ratings_count,
		imageUrl: coverUrl(doc.cover_i, "L"),
		thumbnailUrl: coverUrl(doc.cover_i, "M"),
		description: undefined,
		tags: (doc.subject ?? []).slice(0, 12),
		people: authors,
		externalUrl: id ? `${API}/works/${id}` : undefined,
		releaseDate: doc.first_publish_year
			? `${doc.first_publish_year}-01-01`
			: undefined,
		extra: {
			author: authors.join(", "),
			authors,
			pages: doc.number_of_pages_median,
			isbn: doc.isbn?.[0],
			publisher: doc.publisher?.[0],
			language: doc.language?.[0],
			ratings_count: doc.ratings_count,
			// Alias so templates written for the old Goodreads source still work.
			cover: coverUrl(doc.cover_i, "L"),
		},
	};
}

const FIELDS: FieldSchema = [
	{ name: "author", type: "string", description: "Authors, comma separated" },
	{ name: "authors", type: "list", description: "Authors as a list" },
	{ name: "pages", type: "number", description: "Median page count" },
	{ name: "isbn", type: "string", description: "First known ISBN" },
	{ name: "publisher", type: "string", description: "Publisher" },
	{ name: "language", type: "string", description: "Language code" },
	{ name: "ratings_count", type: "number", description: "Number of ratings" },
	{ name: "cover", type: "string", description: "Cover image URL" },
];

const SEARCH_FIELDS = [
	"key",
	"title",
	"subtitle",
	"author_name",
	"first_publish_year",
	"cover_i",
	"subject",
	"number_of_pages_median",
	"isbn",
	"ratings_average",
	"ratings_count",
	"publisher",
	"language",
].join(",");

export class OpenLibraryProvider
	implements
		MediaProvider,
		Searchable,
		Detailable,
		Resolvable,
		Discoverable,
		Enrichable
{
	readonly id = "openlibrary";
	readonly name = "Open Library (books)";
	readonly kinds: readonly MediaKind[] = ["book"];
	readonly fields = FIELDS;

	constructor(private readonly ctx: ProviderContext) {}

	/** Keyless, so it is always ready to use. */
	isConfigured(): boolean {
		return true;
	}

	settingsSchema(): readonly SettingDescriptor[] {
		return [
			{
				type: "toggle",
				key: "fetchDescription",
				name: "Fetch full description",
				desc: "Loads the work's synopsis. Costs one extra request per note.",
				default: true,
			},
		];
	}

	async search(query: string, ctx: RequestContext): Promise<MediaItem[]> {
		const trimmed = query.trim();
		if (!trimmed) return [];

		const response = await this.ctx.http.getJson<{ docs?: SearchDoc[] }>(
			`${API}/search.json?q=${encodeURIComponent(trimmed)}&limit=20&fields=${SEARCH_FIELDS}`,
			{ signal: ctx.signal, cacheTtlMs: 5 * 60 * 1000 },
		);

		return (response.docs ?? []).filter((d) => d.key).map(toItem);
	}

	/**
	 * The catalogue by description, which books did not have until now.
	 *
	 * Open Library has no "more like this" endpoint, so without this books were
	 * completely invisible to the recommendations — neither half of the row
	 * could ask about them, and a library of two hundred books got suggested
	 * films. Its search takes a Lucene-ish query, so subjects, authors and a
	 * ratings floor all go in one `q`.
	 */
	async discover(
		query: DiscoverQuery,
		ctx: RequestContext,
	): Promise<MediaItem[]> {
		const clauses: string[] = [];
		const quoted = (value: string) => `"${value.replace(/"/g, "")}"`;

		// Subjects are what Open Library has instead of genres, and they are the
		// same field either sort of term lands in.
		const subjects = [
			...(query.keywords ?? []).map((one) => one.name),
			...(query.genres ?? []),
		].slice(0, 3);
		if (subjects.length > 0) {
			clauses.push(`(${subjects.map((s) => `subject:${quoted(s)}`).join(" OR ")})`);
		}
		for (const person of (query.crew ?? query.people ?? []).slice(0, 1)) {
			clauses.push(`author_name:${quoted(person.name)}`);
		}
		for (const out of (query.without ?? []).slice(0, 2)) {
			clauses.push(`NOT subject:${quoted(out)}`);
		}
		// A ratings floor: a five-star average from three people is not a
		// recommendation, and Open Library is full of them.
		//
		// One range clause, and it has to be one. Open Library's search answers
		// `500 Internal Server Error` to any query carrying a range on both
		// `ratings_count` and `ratings_average` — either alone is fine, bounded or
		// open-ended, and together it fails every time. `discoverPlans` always sets
		// `minRating`, so every book request the row has ever made threw, and the
		// engine's own "one source being unreachable must not empty the row" then
		// swallowed it: the hub showed films and television and gave no sign that
		// the shelf it could not reach was the books.
		//
		// `minRating` is honoured by the sort instead. Sorted by rating with a
		// count floor, the first page of a subject comes back at 4.3–4.6 out of
		// five with dozens to hundreds of ratings behind each, which is what the
		// floor was for.
		clauses.push("ratings_count:[20 TO *]");
		if (query.fromYear !== undefined) {
			clauses.push(`first_publish_year:[${query.fromYear} TO *]`);
		}

		const sort = query.sort === "recent" ? "new" : "rating";
		const url =
			`${API}/search.json?q=${encodeURIComponent(clauses.join(" AND "))}` +
			`&sort=${sort}&limit=20&page=${Math.max(1, query.page ?? 1)}` +
			`&fields=${SEARCH_FIELDS}`;

		const response = await this.ctx.http.getJson<{ docs?: SearchDoc[] }>(url, {
			signal: ctx.signal,
			cacheTtlMs: 12 * 60 * 60 * 1000,
		});
		return (response.docs ?? []).filter((d) => d.key).map(toItem);
	}

	/**
	 * The subjects, the author, the length.
	 *
	 * Open Library's subject list is long and noisy — a work can carry a
	 * hundred, half of them library-catalogue artefacts — so it is read from
	 * the work record, where the list is the curated one, and capped.
	 */
	async traits(
		ref: MediaRef,
		ctx: RequestContext,
	): Promise<ProviderTraits | null> {
		const response = await this.ctx.http.getJson<{ docs?: SearchDoc[] }>(
			`${API}/search.json?q=key:/works/${encodeURIComponent(ref.id)}&limit=1&fields=${SEARCH_FIELDS},author_key`,
			{ signal: ctx.signal, cacheTtlMs: 30 * 60 * 1000 },
		);
		const doc = response.docs?.[0];
		if (!doc) return null;

		const authors = doc.author_name ?? [];
		const keys = doc.author_key ?? [];
		return {
			keywords: (doc.subject ?? []).slice(0, 12).map((name) => ({ name })),
			directors: authors.slice(0, 3).map((name, at) => ({
				name,
				...(keys[at] ? { id: keys[at] } : {}),
			})),
			people: [],
			studios: doc.publisher?.slice(0, 1) ?? [],
			...(doc.language?.[0] ? { language: doc.language[0] } : {}),
			// Pages stand in for a runtime; the bands are read off the same scale.
			...(doc.number_of_pages_median
				? { runtime: doc.number_of_pages_median }
				: {}),
		};
	}

	async details(ref: MediaRef, ctx: RequestContext): Promise<MediaItem> {
		// Re-run a targeted search to recover the summary fields, since the
		// works endpoint alone omits authors and ratings.
		const response = await this.ctx.http.getJson<{ docs?: SearchDoc[] }>(
			`${API}/search.json?q=key:/works/${encodeURIComponent(ref.id)}&limit=1&fields=${SEARCH_FIELDS}`,
			{ signal: ctx.signal, cacheTtlMs: 30 * 60 * 1000 },
		);

		const doc = response.docs?.[0];
		const item = doc ? toItem(doc) : null;
		if (!item) throw new Error("Book not found in Open Library");

		if (!this.ctx.settings.get("fetchDescription", true)) return item;

		try {
			const work = await this.ctx.http.getJson<WorkDetails>(
				`${API}/works/${ref.id}.json`,
				{ signal: ctx.signal, cacheTtlMs: 30 * 60 * 1000 },
			);
			const description =
				typeof work.description === "string"
					? work.description
					: work.description?.value;
			if (description) item.description = description;
			if (work.subjects?.length && item.tags.length === 0) {
				item.tags = work.subjects.slice(0, 12);
			}
		} catch {
			// A missing synopsis should not block note creation.
		}

		return item;
	}

	canResolve(url: string): boolean {
		return /openlibrary\.org\/works\/OL\w+/.test(url);
	}

	async resolve(url: string, ctx: RequestContext): Promise<MediaItem> {
		const match = /openlibrary\.org\/works\/(OL\w+)/.exec(url);
		if (!match?.[1]) throw new Error("Not an Open Library work URL");
		return this.details(
			{ providerId: this.id, kind: "book", id: match[1] },
			ctx,
		);
	}
}
