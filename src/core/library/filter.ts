import { MEDIA_KIND_LABELS, type MediaKind } from "../types";
import {
	ratingFraction,
	splitList,
	statusesFor,
	type LibraryConfig,
	type LibraryGroupBy,
	type LibrarySort,
} from "./config";
import type { LibraryEntry } from "./entry";

/**
 * Filtering, sorting, and grouping the library.
 *
 * Pure functions over already-parsed entries, so the view can re-run them on
 * every keystroke and the behaviour can be tested without a vault.
 */

export interface LibraryQuery {
	text: string;
	/** Empty means every kind. */
	kinds: MediaKind[];
	/** Empty means every status, matched case-insensitively. */
	statuses: string[];
	/** An entry must carry all of these. */
	tags: string[];
	/** An entry must belong to all of these collections, by name. */
	collections: string[];
	favoritesOnly: boolean;
	/**
	 * Expressed on the default scale, and compared proportionally — asking for
	 * 4 out of 5 also keeps a film rated 8 out of 10. 0 disables the filter;
	 * unrated entries never pass a non-zero minimum.
	 */
	minRating: number;
	sortBy: LibrarySort;
	groupBy: LibraryGroupBy;
}

export function emptyQuery(config: LibraryConfig): LibraryQuery {
	return {
		text: "",
		kinds: [],
		statuses: [],
		tags: [],
		collections: [],
		favoritesOnly: false,
		minRating: 0,
		sortBy: config.sortBy,
		groupBy: config.groupBy,
	};
}

const lower = (value: string) => value.toLowerCase();

/**
 * Lowercased forms, worked out once per entry and kept for as long as the entry
 * itself lives.
 *
 * The library re-filters on every keystroke, and doing this inside the loop
 * meant lowercasing and joining every title, genre and name in the vault sixty
 * times a second. A `WeakMap` because the key is the entry object: a re-parsed
 * note is a new object with no cache and the old one is collected along with
 * its strings, so nothing here can go stale or accumulate.
 */
interface EntryText {
	haystack: string;
	tags: string[];
	collections: string[];
	status: string;
}

const textCache = new WeakMap<LibraryEntry, EntryText>();

function textOf(entry: LibraryEntry): EntryText {
	const found = textCache.get(entry);
	if (found) return found;
	const built: EntryText = {
		haystack: [
			entry.title,
			entry.basename,
			entry.status ?? "",
			...entry.tags,
			...entry.people,
		]
			.join(" ")
			.toLowerCase(),
		tags: entry.tags.map(lower),
		collections: entry.collections.map(lower),
		status: entry.status ? lower(entry.status) : "",
	};
	textCache.set(entry, built);
	return built;
}

export function filterEntries(
	entries: readonly LibraryEntry[],
	query: LibraryQuery,
	config: LibraryConfig,
): LibraryEntry[] {
	const kinds = query.kinds.length > 0 ? new Set(query.kinds) : null;
	const statuses =
		query.statuses.length > 0 ? new Set(query.statuses.map(lower)) : null;
	const tags = query.tags.map(lower);
	const collections = (query.collections ?? []).map(lower);
	const minFraction =
		config.ratingScale > 0 ? query.minRating / config.ratingScale : 0;
	// Every word must appear somewhere, so "nolan 2010" narrows rather than widens.
	const words = query.text.trim().toLowerCase().split(/\s+/).filter(Boolean);

	const out: LibraryEntry[] = [];
	for (const entry of entries) {
		if (kinds && !kinds.has(entry.kind)) continue;
		if (query.favoritesOnly && !entry.favorite) continue;
		if (query.minRating > 0) {
			const fraction = ratingFraction(config, entry.kind, entry.rating);
			// A hair of tolerance, so 4/5 is not excluded from "4+" by 1e-16.
			if (fraction === undefined || fraction < minFraction - 1e-9) continue;
		}
		if (
			!statuses &&
			tags.length === 0 &&
			collections.length === 0 &&
			words.length === 0
		) {
			out.push(entry);
			continue;
		}
		// Only now is the entry's text worth building, and only once.
		const text = textOf(entry);
		if (statuses && !statuses.has(text.status)) continue;
		if (tags.length > 0 && !tags.every((tag) => text.tags.includes(tag))) {
			continue;
		}
		if (
			collections.length > 0 &&
			!collections.every((name) => text.collections.includes(name))
		) {
			continue;
		}
		if (words.length > 0 && !words.every((w) => text.haystack.includes(w))) {
			continue;
		}
		out.push(entry);
	}
	return out;
}

/* ------------------------------------------------------------------ sorting */

/**
 * Titles, compared. A bare `localeCompare` on purpose: V8 keeps a fast path for
 * exactly this call, and every `Intl.Collator` this was tried against — plain,
 * numeric, case-insensitive — sorted five thousand titles about twice as slowly.
 */
const compareText = (a: string, b: string) => a.localeCompare(b);

/**
 * Each kind's status vocabulary, lowercased, worked out once per sort.
 *
 * `statusesFor` splits a comma-separated setting every time it is asked, and it
 * was being asked from inside a comparator — so an eight-hundred-item sort split
 * the same string ten thousand times.
 */
function statusRanks(config: LibraryConfig): (entry: LibraryEntry) => number {
	const byKind = new Map<MediaKind, Map<string, number>>();
	return (entry) => {
		if (!entry.status) return 999;
		let ranks = byKind.get(entry.kind);
		if (!ranks) {
			ranks = new Map(
				statusesFor(config, entry.kind).map((status, at) => [
					lower(status),
					at,
				]),
			);
			byKind.set(entry.kind, ranks);
		}
		return ranks.get(lower(entry.status)) ?? 998;
	};
}

/**
 * The source's score as a fraction, or undefined when it has none.
 *
 * Zero is nobody having voted rather than a verdict — the same guard the cards
 * make — so an unreleased film does not sort below everything in the library.
 */
function sourceFraction(entry: LibraryEntry): number | undefined {
	const score = entry.sourceRating;
	if (score === undefined || score <= 0) return undefined;
	return Math.min(score / 10, 1);
}

function progressRatio(entry: LibraryEntry): number {
	if (entry.progress === undefined) return -1;
	if (!entry.progressTotal) return entry.progress;
	return entry.progress / entry.progressTotal;
}

/** Sorts a copy; entries missing the sort key always sink to the bottom. */
export function sortEntries(
	entries: readonly LibraryEntry[],
	sortBy: LibrarySort,
	config: LibraryConfig,
): LibraryEntry[] {
	const out = [...entries];
	const byTitle = (a: LibraryEntry, b: LibraryEntry) =>
		compareText(a.title, b.title);
	/**
	 * Proportional, so a book out of five is not beaten by every film out of
	 * ten. `missing` is the value entries with no score at all take, chosen by
	 * the caller so they sink to the bottom whichever direction the sort runs.
	 *
	 * Falling back to the source's score is what stops a backlog from ordering
	 * itself alphabetically: most of a library is unrated, and "the highest
	 * rated thing I have not seen" is the question this sort is usually being
	 * asked. Source scores are always out of ten, whatever scale the notes use.
	 */
	const rank = (entry: LibraryEntry, missing: number) =>
		ratingFraction(config, entry.kind, entry.rating) ??
		sourceFraction(entry) ??
		missing;
	// Your own verdict outranks a borrowed one when the two land on the same
	// number, so a film you gave 8 sits above a film the internet gave 8.
	const mine = (entry: LibraryEntry) => (entry.rating !== undefined ? 1 : 0);

	/**
	 * Keys are worked out inside the comparator rather than cached against each
	 * entry first: a `Map` keyed by object was measured at three times the cost
	 * of simply doing the arithmetic again, because these keys are a subtraction
	 * and a lookup in a Map is not.
	 */

	switch (sortBy) {
		case "title":
			out.sort(byTitle);
			break;
		case "title-desc":
			out.sort((a, b) => byTitle(b, a));
			break;
		case "added":
			// When the note was made, not when it was last touched — the order
			// you built the library in, which "recent" loses the moment you
			// rate something old.
			out.sort((a, b) => b.created - a.created);
			break;
		case "rating-desc":
			out.sort(
				(a, b) =>
					rank(b, -1) - rank(a, -1) || mine(b) - mine(a) || byTitle(a, b),
			);
			break;
		case "rating-asc":
			out.sort(
				(a, b) =>
					rank(a, 2) - rank(b, 2) || mine(b) - mine(a) || byTitle(a, b),
			);
			break;
		case "year-desc":
			out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || byTitle(a, b));
			break;
		case "year-asc":
			out.sort(
				(a, b) =>
					(a.year ?? Number.MAX_SAFE_INTEGER) -
						(b.year ?? Number.MAX_SAFE_INTEGER) || byTitle(a, b),
			);
			break;
		case "status": {
			/**
			 * The one key worth working out in advance: it costs a lowercase and
			 * two map lookups, and a sort would otherwise ask for it a hundred
			 * thousand times over a library of five. Decorated into a parallel
			 * array rather than a `Map` keyed by entry — see above.
			 */
			const rankOf = statusRanks(config);
			const ranked = out.map((entry) => ({ entry, key: rankOf(entry) }));
			ranked.sort(
				(a, b) => a.key - b.key || byTitle(a.entry, b.entry),
			);
			return ranked.map((one) => one.entry);
		}
		case "progress":
			out.sort((a, b) => progressRatio(b) - progressRatio(a) || byTitle(a, b));
			break;
		default:
			// "recent" — most recently edited first, which is what you just touched.
			out.sort((a, b) => b.modified - a.modified);
			break;
	}
	return out;
}

/* ----------------------------------------------------------------- grouping */

export interface LibraryGroup {
	key: string;
	label: string;
	entries: LibraryEntry[];
}

interface GroupKey {
	key: string;
	label: string;
}

/** The reserved key for "this entry has nothing to group by"; always last. */
const NONE = "~none";

/**
 * Which shelves an entry belongs on.
 *
 * Usually one, but a film with four genres belongs on four of them — which is
 * the whole point of grouping by genre, and why this returns a list.
 */
function groupKeysOf(
	entry: LibraryEntry,
	groupBy: LibraryGroupBy,
	config: LibraryConfig,
): GroupKey[] {
	/** Deduplicated case-insensitively, keeping the casing the note used. */
	const fromList = (values: string[], empty: string): GroupKey[] => {
		const seen = new Map<string, GroupKey>();
		for (const value of values) {
			const key = lower(value.trim());
			if (key && !seen.has(key)) seen.set(key, { key, label: value.trim() });
		}
		return seen.size > 0
			? [...seen.values()]
			: [{ key: NONE, label: empty }];
	};

	switch (groupBy) {
		case "kind":
			return [{ key: entry.kind, label: MEDIA_KIND_LABELS[entry.kind] }];
		case "status":
			return entry.status
				? [{ key: lower(entry.status), label: entry.status }]
				: [{ key: NONE, label: "No status" }];
		case "rating": {
			const fraction = ratingFraction(config, entry.kind, entry.rating);
			if (fraction === undefined) {
				return [{ key: NONE, label: "Unrated" }];
			}
			// Bucketed on the default scale, so mixed scales share shelves.
			const rounded = Math.floor(fraction * config.ratingScale);
			return [{ key: `r${rounded}`, label: `${rounded}+` }];
		}
		case "year":
			return entry.year
				? [{ key: String(entry.year), label: String(entry.year) }]
				: [{ key: NONE, label: "No year" }];
		case "decade": {
			if (!entry.year) return [{ key: NONE, label: "No year" }];
			const decade = Math.floor(entry.year / 10) * 10;
			return [{ key: String(decade), label: `${decade}s` }];
		}
		case "genre":
			return fromList(entry.tags, "No genre");
		case "genre-main": {
			// The first genre listed, which every source orders by how defining
			// it is — so a film lands under "Science fiction" rather than under
			// that and three others.
			const main = entry.tags.find((tag) => tag.trim().length > 0);
			return main
				? [{ key: lower(main.trim()), label: main.trim() }]
				: [{ key: NONE, label: "No genre" }];
		}
		case "person":
			return fromList(entry.people, "No one credited");
		case "collection":
			// The whole point of the shelf metaphor: every collection, side by
			// side, with everything loose in one pile at the end.
			return fromList(entry.collections, "In no collection");
		case "favorite":
			return [
				entry.favorite
					? { key: "fav", label: "Favourites" }
					: { key: NONE, label: "Everything else" },
			];
		default:
			return [{ key: "all", label: "" }];
	}
}

/**
 * Groups without re-sorting: the caller has already ordered the entries, and
 * groups come out in the order their first member appears — except for the
 * "none" bucket, which is always last.
 */
export function groupEntries(
	entries: readonly LibraryEntry[],
	groupBy: LibraryGroupBy,
	config: LibraryConfig,
): LibraryGroup[] {
	if (groupBy === "none") {
		return [{ key: "all", label: "", entries: [...entries] }];
	}

	const groups = new Map<string, LibraryGroup>();
	for (const entry of entries) {
		for (const { key, label } of groupKeysOf(entry, groupBy, config)) {
			const group = groups.get(key);
			if (group) group.entries.push(entry);
			else groups.set(key, { key, label, entries: [entry] });
		}
	}

	const out = [...groups.values()];
	if (groupBy === "status") {
		// Follow the configured status order rather than discovery order, so
		// shelves read "To watch → Watching → Watched" as they do in settings.
		const order = new Map<string, number>();
		// One pass per kind present rather than one per entry: the vocabulary is
		// a property of the kind, and splitting it again for every note in the
		// library was the same answer several thousand times.
		const kinds = new Set<MediaKind>();
		for (const entry of entries) kinds.add(entry.kind);
		let next = 0;
		for (const kind of kinds) {
			for (const status of statusesFor(config, kind)) {
				const key = lower(status);
				if (order.has(key)) continue;
				order.set(key, next++);
			}
		}
		out.sort(
			(a, b) => (order.get(a.key) ?? 900) - (order.get(b.key) ?? 900),
		);
	} else if (groupBy === "year" || groupBy === "decade") {
		out.sort((a, b) => Number(b.key || 0) - Number(a.key || 0));
	} else if (groupBy === "rating") {
		out.sort((a, b) => Number(b.key.slice(1) || -1) - Number(a.key.slice(1) || -1));
	} else if (
		groupBy === "genre" ||
		groupBy === "genre-main" ||
		groupBy === "person" ||
		groupBy === "collection"
	) {
		// Discovery order means nothing here, and there can be a lot of these:
		// biggest shelf first, alphabetical to break ties.
		out.sort(
			(a, b) =>
				b.entries.length - a.entries.length ||
				compareText(a.label, b.label),
		);
	}

	const known = out.filter((g) => g.key !== NONE);
	const none = out.filter((g) => g.key === NONE);
	return [...known, ...none];
}

/* -------------------------------------------------------------------- stats */

export interface LibraryStats {
	total: number;
	byKind: { kind: MediaKind; count: number }[];
	rated: number;
	/** On the default scale, whatever scales the individual notes use. */
	averageRating: number | null;
	favorites: number;
	inProgress: number;
	finished: number;
}

export function libraryStats(
	entries: readonly LibraryEntry[],
	config: LibraryConfig,
): LibraryStats {
	const inProgressSet = new Set(splitList(config.inProgressStatuses).map(lower));
	const finishedSet = new Set(splitList(config.finishedStatuses).map(lower));

	const counts = new Map<MediaKind, number>();
	let ratingSum = 0;
	let rated = 0;
	let favorites = 0;
	let inProgress = 0;
	let finished = 0;

	for (const entry of entries) {
		counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
		const fraction = ratingFraction(config, entry.kind, entry.rating);
		if (fraction !== undefined) {
			rated++;
			ratingSum += fraction;
		}
		if (entry.favorite) favorites++;
		const status = entry.status ? lower(entry.status) : "";
		if (inProgressSet.has(status)) inProgress++;
		if (finishedSet.has(status)) finished++;
	}

	return {
		total: entries.length,
		byKind: [...counts.entries()]
			.map(([kind, count]) => ({ kind, count }))
			.sort((a, b) => b.count - a.count),
		rated,
		averageRating:
			rated > 0 ? (ratingSum / rated) * config.ratingScale : null,
		favorites,
		inProgress,
		finished,
	};
}

/** Every genre in the set, most common first — populates the tag filter. */
export function collectTags(entries: readonly LibraryEntry[]): string[] {
	const counts = new Map<string, { label: string; count: number }>();
	for (const entry of entries) {
		for (const tag of entry.tags) {
			const key = lower(tag);
			const found = counts.get(key);
			if (found) found.count++;
			else counts.set(key, { label: tag, count: 1 });
		}
	}
	return [...counts.values()]
		.sort((a, b) => b.count - a.count || compareText(a.label, b.label))
		.map((t) => t.label);
}
