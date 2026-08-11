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
	implements MediaProvider, Searchable, Detailable, Resolvable
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
