import {
	ALL_MEDIA_KINDS,
	MEDIA_KIND_LABELS,
	type MediaKind,
	type MediaRef,
} from "../types";
import {
	FIELD_FALLBACKS,
	splitList,
	type FieldKey,
	type LibraryConfig,
} from "./config";
import {
	parseEpisodeKey,
	readEpisodeLog,
	readWatchedSet,
	type EpisodeId,
	type EpisodeLog,
} from "./episodes";

/**
 * Reading a note into a library entry.
 *
 * Deliberately free of Obsidian imports: everything here takes a plain
 * frontmatter object, so the interesting part — deciding what a note *is* from
 * whatever the user happened to write in it — is unit-testable.
 */

export interface LibraryEntry {
	path: string;
	basename: string;
	title: string;
	kind: MediaKind;
	year?: number;
	/**
	 * The release property as written, which unlike `year` still says how
	 * precisely it was known — the difference between a countdown and "out in
	 * 2027".
	 */
	releaseDate?: string;
	cover?: string;
	tags: string[];
	people: string[];
	/**
	 * The subset of `people` that a credit property named as the author of the
	 * thing — director, creator, writer of the book.
	 *
	 * `people` is one flat list because a note can name its people under any of
	 * a dozen properties and the library only needs "who is on this". Taste
	 * needs more than that: two films by one director is a pattern where two
	 * films sharing a supporting actor is a coincidence, and the difference is
	 * only knowable at read time. `read()` reports the value it found and not
	 * which property it came from, so this is a second, narrower look.
	 */
	authored: string[];
	description?: string;
	url?: string;
	/** Present only when the note records which source it came from. */
	ref?: MediaRef;

	/** The user's own rating, on whatever scale their notes use. */
	rating?: number;
	/** The source's score, always out of ten — every provider normalizes to it. */
	sourceRating?: number;
	status?: string;
	favorite: boolean;
	progress?: number;
	/** Episodes, pages, chapters — read from the metadata, never written. */
	progressTotal?: number;
	started?: string;
	finished?: string;
	/**
	 * Dates you finished it on earlier times through, oldest first. `finished`
	 * stays the latest one, so nothing that reads a single date has to change.
	 */
	history: string[];
	/** How far into a series you are, when the note tracks it that way. */
	currentEpisode?: EpisodeId;
	/** What you made of individual episodes, keyed `S02E05`. */
	episodeLog: EpisodeLog;
	/**
	 * Episodes ticked off outside the run the marker describes.
	 *
	 * Optional because most series never need it: watched in order, the marker
	 * says everything, and an empty list in every note would be noise.
	 */
	watchedEpisodes?: readonly string[];
	/** Collections the note names itself a member of. */
	collections: string[];

	created: number;
	modified: number;
	/** The whole frontmatter, so custom fields need no separate plumbing. */
	frontmatter: Record<string, unknown>;
}

/** The bits of a file the builder needs. Keeps `TFile` out of this module. */
export interface NoteSource {
	path: string;
	basename: string;
	created: number;
	modified: number;
	frontmatter: Record<string, unknown> | undefined;
}

/* ------------------------------------------------------------ value coercion */

function asString(value: unknown): string | undefined {
	if (typeof value === "string") return value.trim() || undefined;
	if (typeof value === "number") return String(value);
	if (Array.isArray(value)) {
		const first = value.find((v) => typeof v === "string");
		return typeof first === "string" ? first.trim() || undefined : undefined;
	}
	return undefined;
}

function asNumber(value: unknown): number | undefined {
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (typeof value === "string") {
		// Tolerates "8/10" and "4 stars", both of which turn up in hand-written notes.
		const match = /-?\d+(\.\d+)?/.exec(value);
		if (!match) return undefined;
		const parsed = Number(match[0]);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function asBoolean(value: unknown): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	if (typeof value === "string") {
		return ["true", "yes", "y", "1", "✓"].includes(value.trim().toLowerCase());
	}
	return false;
}

function asList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.map((v) => (typeof v === "string" ? v : String(v ?? "")))
			.map(stripLink)
			.filter((v) => v.length > 0);
	}
	const text = asString(value);
	if (!text) return [];
	return text
		.split(",")
		.map((part) => stripLink(part))
		.filter((part) => part.length > 0);
}

/** `[[Ridley Scott]]` and `#sci-fi` both mean the plain word to a filter. */
function stripLink(value: string): string {
	return value
		.trim()
		.replace(/^\[\[(.+?)(\|.*)?\]\]$/, "$1")
		.replace(/^#/, "")
		.trim();
}

/** Year from a bare year, an ISO date, or anything with a 4-digit run. */
function asYear(value: unknown): number | undefined {
	const text = asString(value);
	if (!text) return undefined;
	const match = /\d{4}/.exec(text);
	if (!match) return undefined;
	const year = Number(match[0]);
	return year >= 1000 && year <= 3000 ? year : undefined;
}

/* -------------------------------------------------------------- field access */

/**
 * Case-insensitive frontmatter view.
 *
 * Obsidian preserves the case the user typed, and `Status:` is common enough
 * that a case-sensitive lookup would silently drop those notes out of the
 * library.
 */
function indexKeys(
	frontmatter: Record<string, unknown>,
): Map<string, unknown> {
	const map = new Map<string, unknown>();
	for (const [key, value] of Object.entries(frontmatter)) {
		map.set(key.toLowerCase(), value);
	}
	return map;
}

/** The mapped property, then the built-in fallbacks, first hit wins. */
function read(
	keys: Map<string, unknown>,
	config: LibraryConfig,
	field: FieldKey,
): unknown {
	const mapped = config.fields[field]?.trim().toLowerCase();
	if (mapped) {
		const value = keys.get(mapped);
		if (value !== undefined && value !== null && value !== "") return value;
	}
	for (const fallback of FIELD_FALLBACKS[field]) {
		const value = keys.get(fallback);
		if (value !== undefined && value !== null && value !== "") return value;
	}
	return undefined;
}

/**
 * Properties that name whoever a thing is *by*, rather than whoever is in it.
 *
 * Not the `people` fallback list minus a few entries — a deliberately short one.
 * `cast` and `studio` are people too, and they belong in `people`; what makes
 * this list different is that everything on it is a single name the work is
 * attributed to, which is the only kind of credit worth treating as a signature.
 */
const CREDIT_KEYS = [
	"director",
	"directors",
	"author",
	"authors",
	"creator",
	"creators",
	"writer",
	"writers",
] as const;

/**
 * Every credit property that has something in it, not just the first.
 *
 * Unlike `read()` this does not stop at the first hit: a note carrying both a
 * `director` and a `writer` is telling you about two people, and picking one is
 * picking arbitrarily.
 */
function readAuthored(keys: Map<string, unknown>): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const key of CREDIT_KEYS) {
		for (const name of asList(keys.get(key))) {
			const folded = name.trim().toLowerCase();
			if (!folded || seen.has(folded)) continue;
			seen.add(folded);
			out.push(name);
		}
	}
	return out;
}

/* ----------------------------------------------------------------- the kind */

/**
 * Which shelf a note belongs on.
 *
 * The kind id and its label always count, so a note saying `type: movie` is
 * recognized even if the user has emptied the alias list.
 */
export function resolveKind(
	config: LibraryConfig,
	value: unknown,
): MediaKind | null {
	const text = asString(value)?.toLowerCase();
	if (!text) return null;
	const normalized = stripLink(text).toLowerCase();

	for (const kind of ALL_MEDIA_KINDS) {
		if (normalized === kind) return kind;
		if (normalized === MEDIA_KIND_LABELS[kind].toLowerCase()) return kind;
		const aliases = splitList(config.kindAliases[kind]).map((a) =>
			a.toLowerCase(),
		);
		if (aliases.includes(normalized)) return kind;
	}
	return null;
}

/* --------------------------------------------------------------- the builder */

/** Reads a note into an entry, or returns null when it is not library media. */
export function buildEntry(
	config: LibraryConfig,
	source: NoteSource,
): LibraryEntry | null {
	if (!source.frontmatter) return null;
	const keys = indexKeys(source.frontmatter);

	const kind = resolveKind(config, read(keys, config, "kind"));
	if (!kind) return null;

	const providerId = asString(read(keys, config, "provider"));
	const id = asString(read(keys, config, "id"));

	const progressTotal = splitList(config.progressTotalFields)
		.map((field) => asNumber(keys.get(field.toLowerCase())))
		.find((value) => value !== undefined && value > 0);

	return {
		path: source.path,
		basename: source.basename,
		title: asString(read(keys, config, "title")) ?? source.basename,
		kind,
		year: asYear(read(keys, config, "year")),
		releaseDate: asString(read(keys, config, "year")),
		cover: asString(read(keys, config, "cover")),
		tags: asList(read(keys, config, "tags")),
		people: asList(read(keys, config, "people")),
		authored: readAuthored(keys),
		description: asString(read(keys, config, "description")),
		url: asString(read(keys, config, "url")),
		ref: providerId && id ? { providerId, kind, id } : undefined,

		rating: asNumber(read(keys, config, "rating")),
		sourceRating: asNumber(read(keys, config, "sourceRating")),
		status: asString(read(keys, config, "status")),
		favorite: asBoolean(read(keys, config, "favorite")),
		progress: asNumber(read(keys, config, "progress")),
		progressTotal,
		started: asString(read(keys, config, "started")),
		finished: asString(read(keys, config, "finished")),
		history: asList(read(keys, config, "history")),
		currentEpisode:
			parseEpisodeKey(read(keys, config, "episode")) ?? undefined,
		episodeLog: readEpisodeLog(read(keys, config, "episodeLog")),
		watchedEpisodes: [...readWatchedSet(read(keys, config, "watched"))].sort(),
		collections: asList(read(keys, config, "collections")),

		created: source.created,
		modified: source.modified,
		frontmatter: source.frontmatter,
	};
}

/* -------------------------------------------------------------- comparison */

function sameList(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((value, at) => value === b[at]);
}

/**
 * Whether two readings of the same note say the same thing.
 *
 * Used to drop the re-parses that change nothing, which is most of them: the
 * index rebuilds an entry whenever the metadata cache so much as mentions the
 * file, and an entry it hands on is an entry every open view re-filters and
 * re-draws for. Compares what the library can see, frontmatter included, so a
 * custom field edited by hand still counts as a change.
 */
export function sameEntry(a: LibraryEntry, b: LibraryEntry): boolean {
	return (
		a.path === b.path &&
		a.basename === b.basename &&
		a.title === b.title &&
		a.kind === b.kind &&
		a.year === b.year &&
		a.releaseDate === b.releaseDate &&
		a.cover === b.cover &&
		a.description === b.description &&
		a.url === b.url &&
		a.rating === b.rating &&
		a.sourceRating === b.sourceRating &&
		a.status === b.status &&
		a.favorite === b.favorite &&
		a.progress === b.progress &&
		a.progressTotal === b.progressTotal &&
		a.started === b.started &&
		a.finished === b.finished &&
		a.created === b.created &&
		a.modified === b.modified &&
		a.ref?.providerId === b.ref?.providerId &&
		a.ref?.id === b.ref?.id &&
		a.currentEpisode?.season === b.currentEpisode?.season &&
		a.currentEpisode?.episode === b.currentEpisode?.episode &&
		sameList(a.tags, b.tags) &&
		sameList(a.people, b.people) &&
		sameList(a.authored, b.authored) &&
		sameList(a.history, b.history) &&
		sameList(a.collections, b.collections) &&
		sameList(a.watchedEpisodes ?? [], b.watchedEpisodes ?? []) &&
		sameFrontmatter(a.frontmatter, b.frontmatter)
	);
}

/**
 * One level deep, with a stringified comparison for the nested values.
 *
 * Frontmatter is a handful of scalars and the odd list, so the fallback is
 * rare and cheap — and being wrong in the safe direction (calling two equal
 * blocks different) only costs the re-render this is trying to avoid.
 */
function sameFrontmatter(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
): boolean {
	if (a === b) return true;
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) return false;
	for (const key of keys) {
		const left = a[key];
		const right = b[key];
		if (Object.is(left, right)) continue;
		if (
			left === null ||
			right === null ||
			typeof left !== "object" ||
			typeof right !== "object"
		) {
			return false;
		}
		try {
			if (JSON.stringify(left) !== JSON.stringify(right)) return false;
		} catch {
			return false;
		}
	}
	return true;
}

/** Reads one custom field's raw value off an entry. */
export function customValue(entry: LibraryEntry, key: string): unknown {
	const wanted = key.trim().toLowerCase();
	for (const [name, value] of Object.entries(entry.frontmatter)) {
		if (name.toLowerCase() === wanted) return value;
	}
	return undefined;
}

export const coerce = { asString, asNumber, asBoolean, asList, asYear };
