import { ALL_MEDIA_KINDS, type MediaKind } from "../types";

/**
 * How the library reads and writes a note.
 *
 * Scout does not own the notes it indexes — a user's movie notes may predate
 * the plugin, or come from a template of their own. So nothing here is
 * hard-coded: every property name the library touches is a setting, and the
 * vocabulary for kinds and statuses is a setting too.
 */

/* ------------------------------------------------------------- field naming */

/** Frontmatter property names, one per thing the library understands. */
export interface FieldMap {
	kind: string;
	title: string;
	cover: string;
	year: string;
	tags: string;
	people: string;
	description: string;
	url: string;
	provider: string;
	id: string;
	rating: string;
	/** The source's own score, as written by the note templates. Never edited. */
	sourceRating: string;
	status: string;
	favorite: string;
	progress: string;
	started: string;
	finished: string;
}

export type FieldKey = keyof FieldMap;

export const DEFAULT_FIELD_MAP: FieldMap = {
	kind: "type",
	title: "title",
	cover: "cover",
	year: "release_date",
	tags: "genres",
	people: "people",
	description: "description",
	url: "url",
	provider: "source",
	id: "scout_id",
	rating: "rating",
	sourceRating: "source_rating",
	status: "status",
	favorite: "favorite",
	progress: "progress",
	started: "started",
	finished: "finished",
};

/**
 * Properties Scout also accepts when the mapped one is absent.
 *
 * Reading is forgiving on purpose: an existing vault is full of `poster:` and
 * `overview:` and `my_rating:`, and asking someone to re-key every note before
 * the library shows anything would be a poor first run. Writing only ever
 * touches the mapped property.
 */
export const FIELD_FALLBACKS: Record<FieldKey, readonly string[]> = {
	kind: ["type", "kind", "media", "category"],
	title: ["title", "name"],
	cover: ["cover", "poster", "image", "thumbnail", "banner", "art"],
	year: [
		"year",
		"release_date",
		"first_air_date",
		"published_date",
		"published",
		"date",
	],
	tags: ["genres", "tags", "categories", "subjects"],
	people: [
		"people",
		"author",
		"authors",
		"director",
		"directors",
		"cast",
		"creators",
		"developer",
		"studio",
	],
	description: ["description", "overview", "summary", "synopsis", "blurb"],
	url: ["url", "link", "external_url", "website"],
	provider: ["source", "provider"],
	id: ["scout_id", "source_id"],
	rating: ["rating", "my_rating", "score"],
	sourceRating: [
		"source_rating",
		"tmdb_rating",
		"imdb_rating",
		"anilist_rating",
		"goodreads_rating",
		"average_rating",
		"public_rating",
	],
	status: ["status", "state", "shelf"],
	favorite: ["favorite", "favourite", "starred"],
	progress: ["progress", "episodes_watched", "pages_read", "current"],
	started: ["started", "start_date", "started_on"],
	finished: ["finished", "completed", "finish_date", "finished_on"],
};

/** Labels for the field-mapping settings, and whether Scout writes the key. */
export const FIELD_INFO: Record<
	FieldKey,
	{ name: string; desc: string; writes: boolean }
> = {
	kind: {
		name: "Media type",
		desc: "Property that says what a note is. Its value decides which shelf the note lands on.",
		writes: false,
	},
	title: { name: "Title", desc: "Falls back to the filename.", writes: false },
	cover: { name: "Cover image", desc: "URL or vault path.", writes: false },
	year: {
		name: "Release date",
		desc: "A year or a full date; only the year is displayed.",
		writes: false,
	},
	tags: { name: "Genres", desc: "Used by the genre filter.", writes: false },
	people: {
		name: "People",
		desc: "Cast, authors, directors.",
		writes: false,
	},
	description: { name: "Description", desc: "Synopsis or blurb.", writes: false },
	url: { name: "Source link", desc: "Page on the original site.", writes: false },
	provider: {
		name: "Source id",
		desc: "Which source the note came from. Used to match a note back to a search result.",
		writes: false,
	},
	id: {
		name: "Item id",
		desc: "The source's own id for the item.",
		writes: false,
	},
	rating: { name: "Your rating", desc: "Written when you rate.", writes: true },
	sourceRating: {
		name: "Source rating",
		desc: "The source's own score, out of ten. Shown on cards you have not rated yourself.",
		writes: false,
	},
	status: { name: "Status", desc: "Written when you change status.", writes: true },
	favorite: { name: "Favourite", desc: "Written as true or false.", writes: true },
	progress: {
		name: "Progress",
		desc: "Episodes watched, pages read, hours played.",
		writes: true,
	},
	started: { name: "Started on", desc: "Date you began.", writes: true },
	finished: { name: "Finished on", desc: "Date you finished.", writes: true },
};

/* ------------------------------------------------------------------- kinds */

/** Frontmatter values that mean a given kind. Matched case-insensitively. */
export const DEFAULT_KIND_ALIASES: Record<MediaKind, string> = {
	movie: "movie, film",
	tv: "tv, tv show, show, series, television",
	book: "book, novel",
	game: "game, video game, videogame",
	anime: "anime",
	manga: "manga",
	link: "link, article, web, bookmark",
};

/* ---------------------------------------------------------------- statuses */

export const DEFAULT_STATUSES: Record<MediaKind, string> = {
	movie: "To watch, Watching, Watched, On hold, Dropped",
	tv: "To watch, Watching, Watched, On hold, Dropped",
	anime: "To watch, Watching, Watched, On hold, Dropped",
	book: "To read, Reading, Read, On hold, Dropped",
	manga: "To read, Reading, Read, On hold, Dropped",
	game: "To play, Playing, Played, On hold, Dropped",
	link: "To read, Read, Archived",
};

/** Statuses that mean "in progress" — used to stamp the start date. */
export const DEFAULT_IN_PROGRESS = "Watching, Reading, Playing, In progress";

/** Statuses that mean "done" — used to stamp the finish date. */
export const DEFAULT_FINISHED =
	"Watched, Read, Played, Completed, Finished, Done";

/** Statuses that mean "started but set aside". */
export const DEFAULT_PAUSED = "On hold, Paused, Waiting";

/** Statuses that mean "given up on". */
export const DEFAULT_DROPPED = "Dropped, Abandoned, Did not finish, DNF";

/**
 * What a status *means*, as opposed to what it is called.
 *
 * Statuses are free text the user chooses, so nothing can be keyed off the
 * word itself. Sorting them into a handful of tones is what lets Scout give
 * each one an icon and a colour without dictating a vocabulary.
 */
export type StatusTone = "planned" | "active" | "done" | "paused" | "dropped";

export function statusTone(
	config: LibraryConfig,
	status: string | undefined,
): StatusTone | null {
	if (!status) return null;
	const needle = status.trim().toLowerCase();
	if (!needle) return null;
	const has = (list: string) =>
		splitList(list).some((value) => value.toLowerCase() === needle);

	if (has(config.inProgressStatuses)) return "active";
	if (has(config.finishedStatuses)) return "done";
	if (has(config.pausedStatuses)) return "paused";
	if (has(config.droppedStatuses)) return "dropped";
	// Anything left is something you have not started: "To watch", "Backlog",
	// "Wishlist". Treating that as the default keeps it to two extra settings.
	return "planned";
}

/* ----------------------------------------------------------- custom fields */

export type CustomFieldType =
	| "text"
	| "number"
	| "date"
	| "checkbox"
	| "select";

/**
 * A field the user invented. Rendered in the manage panel alongside the
 * built-in ones and written straight to frontmatter under `key`.
 */
export interface CustomField {
	/** Stable identity, so renaming the key does not orphan the definition. */
	id: string;
	key: string;
	label: string;
	type: CustomFieldType;
	/** Choices for `select`, as a comma-separated list. */
	options: string;
	/** Kinds this field applies to. Empty means every kind. */
	kinds: MediaKind[];
}

/* --------------------------------------------------------------- the config */

export type LibraryLayout = "grid" | "list" | "table";

/**
 * Genre and person put one entry on several shelves at once — a film is both
 * science fiction and a thriller — so grouping is many-to-many, not a bucket
 * per entry.
 *
 * `genre-main` is the one-shelf version of the same idea: sources list genres
 * most-defining first, so the first one is a fair answer to "what is this",
 * and a library grouped that way has every item exactly once.
 */
export type LibraryGroupBy =
	| "none"
	| "kind"
	| "status"
	| "rating"
	| "decade"
	| "year"
	| "genre"
	| "genre-main"
	| "person"
	| "favorite";

export type LibrarySort =
	| "recent"
	| "added"
	| "title"
	| "title-desc"
	| "rating-desc"
	| "rating-asc"
	| "year-desc"
	| "year-asc"
	| "status"
	| "progress";

export type RatingIcon = "star" | "heart" | "circle" | "number";

export interface LibraryConfig {
	/** Whole vault, or only the folders notes are created in. */
	scope: "vault" | "folders";
	/** Extra folders to index, comma-separated. */
	includeFolders: string;
	/** Folders to skip, comma-separated. */
	excludeFolders: string;

	fields: FieldMap;
	/** Comma-separated frontmatter values that map onto each kind. */
	kindAliases: Record<MediaKind, string>;
	/** Comma-separated status vocabulary per kind. */
	statuses: Record<MediaKind, string>;
	inProgressStatuses: string;
	finishedStatuses: string;
	pausedStatuses: string;
	droppedStatuses: string;
	/** Stamp the start/finish dates when the status changes. */
	autoTimestamps: boolean;

	/** Top of the rating range: 5, 10, or 100. */
	ratingScale: number;
	/**
	 * Per-kind overrides of the scale; kinds absent here use `ratingScale`.
	 *
	 * One scale rarely covers a whole vault — film notes copied from a source
	 * tend to be out of ten while books are out of five — and rewriting the
	 * frontmatter of every note to agree is not something a settings toggle
	 * should do. So the scale bends to the notes instead.
	 */
	ratingScales: Partial<Record<MediaKind, number>>;
	/** Smallest rating increment, e.g. 0.5 for half stars. */
	ratingStep: number;
	ratingIcon: RatingIcon;

	/** Heading whose section holds your notes on an item. */
	thoughtsHeading: string;
	/** Properties to read a progress total from, comma-separated. */
	progressTotalFields: string;

	layout: LibraryLayout;
	/** Grid cover width in pixels. */
	cardSize: number;
	groupBy: LibraryGroupBy;
	sortBy: LibrarySort;
	showCovers: boolean;
	showRatings: boolean;
	showStatus: boolean;
	showStats: boolean;
	/** Open the detail dialog on click; otherwise open the note itself. */
	openDetailOnClick: boolean;
	openInNewTab: boolean;
	confirmDelete: boolean;

	customFields: CustomField[];
}

function perKind(source: Record<MediaKind, string>): Record<MediaKind, string> {
	const out = {} as Record<MediaKind, string>;
	for (const kind of ALL_MEDIA_KINDS) out[kind] = source[kind];
	return out;
}

export function defaultLibraryConfig(): LibraryConfig {
	return {
		scope: "vault",
		includeFolders: "",
		excludeFolders: "",

		fields: { ...DEFAULT_FIELD_MAP },
		kindAliases: perKind(DEFAULT_KIND_ALIASES),
		statuses: perKind(DEFAULT_STATUSES),
		inProgressStatuses: DEFAULT_IN_PROGRESS,
		finishedStatuses: DEFAULT_FINISHED,
		pausedStatuses: DEFAULT_PAUSED,
		droppedStatuses: DEFAULT_DROPPED,
		autoTimestamps: true,

		ratingScale: 5,
		ratingScales: {},
		ratingStep: 0.5,
		ratingIcon: "star",

		thoughtsHeading: "Thoughts",
		progressTotalFields:
			"number_of_episodes, episodes, pages, chapters, volumes",

		layout: "grid",
		cardSize: 150,
		groupBy: "none",
		sortBy: "recent",
		showCovers: true,
		showRatings: true,
		showStatus: true,
		showStats: true,
		openDetailOnClick: true,
		openInNewTab: false,
		confirmDelete: true,

		customFields: [],
	};
}

/** Fills in anything a stored config predates, without discarding user values. */
export function normalizeLibraryConfig(
	stored: Partial<LibraryConfig> | undefined,
): LibraryConfig {
	const base = defaultLibraryConfig();
	if (!stored) return base;
	return {
		...base,
		...stored,
		fields: { ...base.fields, ...stored.fields },
		kindAliases: { ...base.kindAliases, ...stored.kindAliases },
		statuses: { ...base.statuses, ...stored.statuses },
		ratingScale: validScale(stored.ratingScale) ?? base.ratingScale,
		ratingScales: cleanScales(stored.ratingScales),
		customFields: stored.customFields ?? [],
	};
}

/** Discards overrides for kinds that no longer exist, and unusable scales. */
function cleanScales(
	stored: Partial<Record<MediaKind, number>> | undefined,
): Partial<Record<MediaKind, number>> {
	const out: Partial<Record<MediaKind, number>> = {};
	if (!stored) return out;
	for (const kind of ALL_MEDIA_KINDS) {
		const scale = validScale(stored[kind]);
		if (scale !== undefined) out[kind] = scale;
	}
	return out;
}

function validScale(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;
}

/* ------------------------------------------------------------------ helpers */

/** Splits a comma-separated setting into trimmed, non-empty values. */
export function splitList(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

export function statusesFor(
	config: LibraryConfig,
	kind: MediaKind,
): string[] {
	const own = splitList(config.statuses[kind]);
	return own.length > 0 ? own : splitList(DEFAULT_STATUSES[kind]);
}

/** Every status across every kind, in a stable order, for the global filter. */
export function allStatuses(config: LibraryConfig): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const kind of ALL_MEDIA_KINDS) {
		for (const status of statusesFor(config, kind)) {
			const key = status.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(status);
		}
	}
	return out;
}

/** The scale a kind's ratings are on, falling back to the global one. */
export function ratingScaleFor(
	config: LibraryConfig,
	kind: MediaKind,
): number {
	return config.ratingScales[kind] ?? config.ratingScale;
}

/**
 * A rating as a fraction of its own scale.
 *
 * Sorting, filtering, and averaging all happen across kinds, so a film out of
 * ten and a book out of five have to be brought onto common ground first.
 */
export function ratingFraction(
	config: LibraryConfig,
	kind: MediaKind,
	rating: number | undefined,
): number | undefined {
	if (rating === undefined) return undefined;
	const scale = ratingScaleFor(config, kind);
	if (!(scale > 0)) return undefined;
	return Math.min(Math.max(rating / scale, 0), 1);
}

/** Custom fields that apply to a kind. */
export function customFieldsFor(
	config: LibraryConfig,
	kind: MediaKind,
): CustomField[] {
	return config.customFields.filter(
		(field) =>
			field.key.trim().length > 0 &&
			(field.kinds.length === 0 || field.kinds.includes(kind)),
	);
}
