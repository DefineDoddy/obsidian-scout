import { sourceKey, type MediaItem, type MediaKind } from "../types";
// Types only: `enrich.ts` reaches back here through `recommend.ts`, and a
// value import would make that a cycle at run time rather than only on paper.
import type { EnrichmentCache, EnrichmentRecord } from "./enrich";
import type { LibraryEntry } from "./entry";
import type { FeedbackRecord } from "./feedback";

/**
 * The vocabulary the model thinks in.
 *
 * Before this there were two features — a genre and a name — and everything
 * else the taste model did was arithmetic on top of a vocabulary of about
 * twenty words. "Drama" is shared by a third of everything ever made, so a
 * profile built from genres alone can tell you what shelf you stand in front
 * of and nothing whatsoever about what you take off it.
 *
 * A trait is a namespace and a value: `genre:thriller`, `director:denis
 * villeneuve`, `decade:2010`. Namespaced strings rather than objects because
 * they are map keys, they compare with `===`, they serialise into stored
 * feedback for free, and reading one back is a single `indexOf`.
 *
 * What each namespace is *worth*, and how much evidence it needs before it is
 * believed, differ enormously and are declared once here rather than being
 * spread through the scoring. Two films by one director is a pattern; two
 * films sharing "Drama" is a coincidence; two films in one series is not even
 * a question.
 */

export type Namespace =
	| "genre"
	| "keyword"
	| "person"
	| "director"
	| "studio"
	| "series"
	| "decade"
	| "language"
	| "runtime"
	| "collection";

/**
 * Deliberately not a plain string, so a raw genre name cannot be passed where
 * a trait is expected. The brand costs nothing at runtime.
 */
export type TraitKey = string & { readonly __trait: unique symbol };

/** A trait and the spelling to show a person, which the key has folded away. */
export interface Trait {
	key: TraitKey;
	label: string;
}

export function traitKey(ns: Namespace, value: string): TraitKey {
	return `${ns}:${value.trim().toLowerCase()}` as TraitKey;
}

export function parseTrait(
	key: TraitKey | string,
): { ns: Namespace; value: string } | null {
	const at = key.indexOf(":");
	if (at <= 0) return null;
	return {
		ns: key.slice(0, at) as Namespace,
		value: key.slice(at + 1),
	};
}

/**
 * How much evidence a namespace needs before its affinity is taken at face
 * value — the shrinkage denominator, extending the reasoning that used to be
 * written against `GENRE_PRIOR` and `PERSON_PRIOR` alone.
 *
 * Decade, language and runtime sit high because almost every library is
 * accidentally lopsided on all three: owning mostly recent films is a fact
 * about what gets made, not a preference, and it takes a lot of evidence
 * before it becomes one.
 */
export const NAMESPACE_PRIOR: Record<Namespace, number> = {
	series: 0.6,
	director: 0.8,
	person: 1.2,
	studio: 1.5,
	keyword: 1.8,
	collection: 2,
	genre: 2.5,
	decade: 3,
	language: 3,
	runtime: 4,
};

/** What one point of affinity in a namespace is worth to a candidate's score. */
export const NAMESPACE_WEIGHT: Record<Namespace, number> = {
	genre: 1.5,
	series: 1.4,
	director: 1.3,
	keyword: 1.1,
	person: 0.9,
	collection: 0.8,
	studio: 0.7,
	language: 0.5,
	decade: 0.4,
	runtime: 0.25,
};

/**
 * How many traits of a namespace may contribute to one candidate's score.
 *
 * A cap rather than a sum, because the alternative is that a film listing
 * eleven keywords beats an equally good one listing three on volume alone.
 */
export const NAMESPACE_CAP: Record<Namespace, number> = {
	keyword: 4,
	genre: 3,
	person: 3,
	director: 2,
	collection: 2,
	studio: 1,
	series: 1,
	decade: 1,
	language: 1,
	runtime: 1,
};

/** Cast members past the first few are people you did not notice were there. */
const PEOPLE_CAP = 4;

export interface TraitOptions {
	/**
	 * Collections you keep by hand. A smart collection is a rule over fields
	 * the model already reads, so counting it would count them twice.
	 */
	manualCollections?: ReadonlySet<string>;
	/** What the sources have said, beyond what the notes record. */
	enrichment?: Readonly<EnrichmentCache>;
}

/**
 * Traits from a harvest, which is where nearly all of the good ones are.
 *
 * A note's frontmatter yields a genre list and one name. This yields what the
 * thing is *about* — and "you keep going for time loops" is not a sentence a
 * model built from eighteen genres can ever produce.
 */
function addHarvest(
	bag: TraitBag,
	record: EnrichmentRecord | undefined,
	kind: MediaKind,
): void {
	if (!record) return;
	for (const one of record.keywords) bag.add("keyword", one.name);
	for (const one of record.directors) bag.add("director", one.name);
	let counted = 0;
	for (const one of record.people) {
		if (bag.has("director", one.name)) continue;
		if (counted >= PEOPLE_CAP) break;
		bag.add("person", one.name);
		counted += 1;
	}
	for (const name of record.studios) bag.add("studio", name);
	if (record.language) bag.add("language", record.language);
	const band = runtimeBand(record.runtime, kind);
	if (band) bag.add("runtime", band);
	if (record.series) {
		bag.take({
			key: traitKey("series", record.series.id),
			label: record.series.name,
		});
	}
}

/* -------------------------------------------------------------- assembling */

/** Collects traits without duplicates, first spelling seen winning the label. */
class TraitBag {
	private readonly seen = new Set<string>();
	readonly out: Trait[] = [];

	add(ns: Namespace, value: string | undefined | null): void {
		if (typeof value !== "string") return;
		const label = value.trim();
		if (!label) return;
		this.take({ key: traitKey(ns, label), label });
	}

	/** An already-made trait, from a cache or from another bag. */
	take(trait: Trait): void {
		if (this.seen.has(trait.key)) return;
		this.seen.add(trait.key);
		this.out.push(trait);
	}

	has(ns: Namespace, value: string): boolean {
		return this.seen.has(traitKey(ns, value));
	}
}

/** The decade something came out in, as a trait and as a readable label. */
function addDecade(bag: TraitBag, year: number | undefined): void {
	if (!year || !Number.isFinite(year)) return;
	const decade = Math.floor(year / 10) * 10;
	bag.add("decade", `${decade}s`);
}

/**
 * How long a thing is, as a band rather than as a number.
 *
 * Ninety-four minutes and ninety-six minutes are the same fact about an
 * evening. What a person has an actual preference about is whether something
 * is short, ordinary, long, or a commitment.
 *
 * The thresholds have to be per kind, because the unit is. A book's length
 * comes through as pages, and four hundred of them is an ordinary novel where
 * four hundred minutes would be an ordeal.
 */
const BANDS: Record<"time" | "pages", [number, number, number]> = {
	time: [60, 125, 180],
	pages: [150, 400, 700],
};

export function runtimeBand(
	value: number | undefined,
	kind?: MediaKind,
): string | undefined {
	if (!value || !Number.isFinite(value) || value <= 0) return undefined;
	const [short, standard, long] =
		kind === "book" || kind === "manga" ? BANDS.pages : BANDS.time;
	if (value < short) return "short";
	if (value <= standard) return "standard";
	if (value <= long) return "long";
	return "epic";
}

/**
 * Traits an entry has on the strength of its own frontmatter.
 *
 * Cached on the entry object: `LibraryIndex` only hands out a new entry when
 * `sameEntry` says the note actually changed, so identity is a sound key and
 * invalidation costs nothing. Collections are added outside the cache because
 * which collections are manual is a setting, not a property of the note.
 */
const ENTRY_TRAITS = new WeakMap<LibraryEntry, Trait[]>();

function ownTraits(entry: LibraryEntry): Trait[] {
	const cached = ENTRY_TRAITS.get(entry);
	if (cached) return cached;

	const bag = new TraitBag();
	for (const tag of entry.tags) bag.add("genre", tag);
	// The names a credit property attributed the thing to. Held apart from the
	// rest because a signature is worth more than an appearance.
	for (const name of entry.authored) bag.add("director", name);
	let counted = 0;
	for (const name of entry.people) {
		if (bag.has("director", name)) continue;
		if (counted >= PEOPLE_CAP) break;
		bag.add("person", name);
		counted += 1;
	}
	addDecade(bag, entry.year);

	ENTRY_TRAITS.set(entry, bag.out);
	return bag.out;
}

export function traitsOfEntry(
	entry: LibraryEntry,
	options: TraitOptions = {},
): Trait[] {
	const own = ownTraits(entry);
	const harvest = entry.ref
		? options.enrichment?.[sourceKey(entry.ref)]
		: undefined;
	const manual = options.manualCollections;
	const shelves = manual
		? entry.collections.filter((name) => manual.has(name.trim().toLowerCase()))
		: [];

	// The common case on a library nobody has read up on yet: hand back the
	// cached array untouched rather than copying it on every render.
	if (!harvest && shelves.length === 0) return own;

	const bag = new TraitBag();
	for (const one of own) bag.take(one);
	addHarvest(bag, harvest, entry.kind);
	for (const name of shelves) bag.add("collection", name);
	return bag.out;
}

/** Names off a provider's `extra` bag, which may hold a list or one string. */
function asNames(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((one): one is string => typeof one === "string");
	}
	return typeof value === "string" ? [value] : [];
}

/**
 * The same, off a source record.
 *
 * Richer than an entry even before anything is enriched, because a provider
 * hands back its credits and its series where a note only keeps what the
 * template thought to write down.
 */
export function traitsOfItem(item: MediaItem): Trait[] {
	const bag = new TraitBag();
	for (const tag of item.tags) bag.add("genre", tag);
	for (const name of asNames(item.extra.directors)) bag.add("director", name);
	let counted = 0;
	for (const name of item.people) {
		if (bag.has("director", name)) continue;
		if (counted >= PEOPLE_CAP) break;
		bag.add("person", name);
		counted += 1;
	}
	for (const name of asNames(item.extra.studios)) bag.add("studio", name);

	// The series id rather than its name: two catalogues spell "The Lord of the
	// Rings Collection" differently and mean the same shelf.
	const series = item.extra.series_id ?? item.extra.collection_id;
	if (typeof series === "string" && series) {
		const label = asNames(item.extra.series ?? item.extra.collection)[0];
		bag.take({
			key: traitKey("series", `${item.ref.providerId}:${series}`),
			label: label ?? "the same series",
		});
	}

	addDecade(bag, item.year);
	const band = runtimeBand(
		typeof item.extra.runtime === "number" ? item.extra.runtime : undefined,
		item.ref.kind,
	);
	if (band) bag.add("runtime", band);

	return bag.out;
}

/**
 * The traits behind a thumbs-up or a thumbs-down.
 *
 * Newer records carry their traits outright, worked out at the moment the vote
 * was cast — and until now this function ignored them and re-derived a genre
 * list from `tags`. So a thumbs-up on a film carrying a director, a studio, a
 * series and eleven keywords taught the model four genres and three names, and
 * everything that made the record worth keeping was dropped on the way in. The
 * one button whose entire job is to correct the model was the one signal read
 * most poorly.
 *
 * Records written before traits existed still fall back to the tags and names
 * that were trimmed off the suggestion at the time. Their labels come out of the
 * key, so they read lower-cased; `buildTaste` only takes a label for a trait it
 * has not already seen, so anything the library itself knows keeps its spelling.
 */
export function traitsOfRecord(record: FeedbackRecord): Trait[] {
	const bag = new TraitBag();
	for (const key of record.traits ?? []) {
		const parsed = parseTrait(key);
		if (!parsed || !parsed.value) continue;
		bag.take({ key, label: parsed.value });
	}
	for (const tag of record.tags) bag.add("genre", tag);
	for (const name of record.people.slice(0, PEOPLE_CAP)) bag.add("person", name);
	return bag.out;
}
