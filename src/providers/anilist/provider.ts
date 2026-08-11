import type {
	MediaProvider,
	ProviderContext,
	RequestContext,
	Resolvable,
	Searchable,
} from "../../core/provider";
import type { SettingDescriptor } from "../../core/settings/types";
import type { FieldSchema, MediaItem, MediaKind } from "../../core/types";

/**
 * AniList (anime and manga).
 *
 * Keyless GraphQL. Included specifically to prove the provider abstraction is
 * not REST-shaped: this one POSTs a query document and never builds a URL path,
 * yet needs no changes anywhere outside this file. Its search response is
 * already complete, so it implements `Searchable` but not `Detailable`.
 */

const ENDPOINT = "https://graphql.anilist.co";

const SEARCH_QUERY = `
query ($search: String, $type: MediaType) {
  Page(perPage: 20) {
    media(search: $search, type: $type, sort: SEARCH_MATCH) {
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
    }
  }
}`;

const BY_ID_QUERY = `
query ($id: Int) {
  Media(id: $id) {
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
  }
}`;

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

export class AniListProvider implements MediaProvider, Searchable, Resolvable {
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
