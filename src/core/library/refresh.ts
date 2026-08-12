import { toTemplateContext, type MediaItem } from "../types";
import {
	FIELD_FALLBACKS,
	statusTone,
	type FieldKey,
	type LibraryConfig,
} from "./config";
import type { LibraryEntry } from "./entry";
import { releaseCountdown } from "./release";

/**
 * Keeping notes current without asking the same question every day.
 *
 * A note is a snapshot of what a source knew on the day it was made, and some
 * of what it holds moves: a score settles over the first month, a date slips, a
 * show gains a season. Re-asking is cheap for one note and expensive for a
 * thousand, so the whole of this module is about asking as rarely as the facts
 * allow — a film from 1994 has nothing left to tell anyone, and something out
 * next spring changes every week.
 *
 * Three rules keep it safe rather than merely cheap:
 *
 * 1. Anything that is yours is never written. Your rating, your status, your
 *    dates, your progress, your title, your cover — the whole of the manage
 *    panel — is off limits, whatever a source happens to call its own fields.
 * 2. Nothing new is added to a note except the source's score. A note that
 *    never recorded a runtime does not grow one.
 * 3. A note whose facts have not moved is not written to at all. Most checks
 *    find nothing, and a plugin that touched a hundred files a day to record
 *    that nothing had changed would wreck "recently updated" for its own
 *    bookkeeping. When the check happened is kept in Scout's own data instead.
 *
 * Pure: no Obsidian, no network, no clock.
 */

/* -------------------------------------------------------------- protection */

/**
 * Fields that belong to the user, or that identify the note.
 *
 * Named as `FieldKey`s rather than as literal property names so the guard
 * follows the field mapping: someone who calls their rating `score` is
 * protected under that name too, along with every read-time fallback — which
 * matters most for `status`, where TMDB's own word for a film ("Released")
 * would otherwise land on the property holding the shelf a note is on.
 */
const NEVER_WRITTEN: readonly FieldKey[] = [
	"rating",
	"status",
	"favorite",
	"progress",
	"started",
	"finished",
	"history",
	"episode",
	"episodeLog",
	"watched",
	"title",
	"cover",
	"kind",
	"provider",
	"id",
];

/** Placeholders about the moment of writing rather than about the item. */
const NEVER_WRITTEN_LITERAL = ["now", "created", "date_added", "added"];

function guardedNames(config: LibraryConfig): Set<string> {
	const out = new Set<string>(NEVER_WRITTEN_LITERAL);
	for (const field of NEVER_WRITTEN) {
		const mapped = config.fields[field]?.trim().toLowerCase();
		if (mapped) out.add(mapped);
		for (const fallback of FIELD_FALLBACKS[field]) out.add(fallback);
	}
	return out;
}

/**
 * The property a note actually keeps the source's score under.
 *
 * `tmdb_rating` for anything made from the film template, `source_rating` for
 * the rest — updating whichever one is already there beats adding a second.
 */
export function sourceRatingKey(
	config: LibraryConfig,
	entry: LibraryEntry,
): string {
	const present = new Set(
		Object.keys(entry.frontmatter).map((key) => key.toLowerCase()),
	);
	const mapped = config.fields.sourceRating?.trim();
	for (const name of [mapped, ...FIELD_FALLBACKS.sourceRating]) {
		if (name && present.has(name.toLowerCase())) return name;
	}
	return mapped || "source_rating";
}

/* ----------------------------------------------------------------- the diff */

/** Whether two frontmatter values say the same thing. */
function same(a: unknown, b: unknown): boolean {
	if (Array.isArray(a) || Array.isArray(b)) {
		const left = Array.isArray(a) ? a : [a];
		const right = Array.isArray(b) ? b : [b];
		return (
			left.length === right.length &&
			left.every((value, i) => String(value) === String(right[i]))
		);
	}
	return String(a ?? "") === String(b ?? "");
}

export interface RefreshPatch {
	/** Frontmatter to write. Empty when the source had nothing new to say. */
	values: Record<string, unknown>;
	/** Which properties moved, named as the note spells them. */
	changed: string[];
}

/**
 * What a fresh record means for a note.
 *
 * Everything the note already records and the source still knows is compared,
 * and only the differences come back — so a note whose facts have not moved
 * yields an empty patch and is never opened for writing.
 */
export function refreshPatch(
	config: LibraryConfig,
	entry: LibraryEntry,
	item: MediaItem,
): RefreshPatch {
	const guarded = guardedNames(config);

	// The note's own spelling of each property, so an update rewrites
	// `Release_Date:` rather than adding a second `release_date:` beside it.
	const spelling = new Map<string, string>();
	for (const key of Object.keys(entry.frontmatter)) {
		spelling.set(key.toLowerCase(), key);
	}

	const values: Record<string, unknown> = {};
	const changed: string[] = [];

	const put = (name: string, value: unknown) => {
		const key = spelling.get(name.toLowerCase()) ?? name;
		if (same(entry.frontmatter[key], value)) return;
		values[key] = value;
		changed.push(key);
	};

	for (const [name, raw] of Object.entries(toTemplateContext(item))) {
		const key = name.toLowerCase();
		if (guarded.has(key)) continue;
		// Only what the note already keeps. A refresh brings a note up to date;
		// it does not decide which properties a note ought to have.
		if (!spelling.has(key)) continue;
		if (raw === undefined || raw === null || raw === "") continue;
		const value = Array.isArray(raw) ? [...raw] : raw;
		if (Array.isArray(value) && value.length === 0) continue;
		put(name, value);
	}

	// The one exception to "nothing new": the source's score is what a card
	// falls back to on everything you have not rated yourself, and plenty of
	// notes have none — hand-written ones, and any made before Scout kept it.
	if (typeof item.rating === "number" && item.rating > 0) {
		put(sourceRatingKey(config, entry), item.rating);
	}

	return { values, changed };
}

/* -------------------------------------------------------------- staleness */

/** Local midnight for `YYYY-MM-DD`, or null when it is not a date. */
function parseDay(raw: string | undefined): Date | null {
	if (!raw) return null;
	const match = /(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
	if (!match) return null;
	return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function wholeDaysBetween(from: Date, to: Date): number {
	const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
	const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
	return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

/** When each note was last asked about, `YYYY-MM-DD` keyed by note path. */
export type CheckLog = Readonly<Record<string, string>>;

/**
 * How long a note can go without being asked about.
 *
 * The one decision that makes this affordable, and nothing in it is a setting,
 * because none of it is a preference: a film that came out thirty years ago
 * genuinely has nothing new to say, and something dated next month genuinely
 * changes week to week. A library of five hundred mostly-old items settles at
 * a handful of requests a day.
 */
export function refreshIntervalDays(
	config: LibraryConfig,
	entry: LibraryEntry,
	now: Date = new Date(),
): number {
	// A saved web page is whatever it was when it was saved.
	if (entry.kind === "link") return 180;

	// Not out yet: the date is the thing that moves, and there is no score to
	// settle until there is.
	if (releaseCountdown(entry.releaseDate, now) !== null) return 3;
	// No year at all is an announcement — a name and nothing else.
	if (entry.year === undefined) return 7;

	// Part-way through a series is the case where a season appearing actually
	// changes what the app can show you.
	if (statusTone(config, entry.status) === "active") return 7;

	// The first year is when a score is still finding its level.
	return now.getFullYear() - entry.year <= 1 ? 14 : 90;
}

/** Days a note has waited past its own interval. Negative means not yet due. */
export function overdueBy(
	config: LibraryConfig,
	entry: LibraryEntry,
	checked: CheckLog,
	now: Date = new Date(),
): number {
	// Never asked about: a note made today already holds what the source said
	// today, so the clock starts when the note does.
	const last = parseDay(checked[entry.path]) ?? new Date(entry.created);
	return wholeDaysBetween(last, now) - refreshIntervalDays(config, entry, now);
}

/** Whether a note both can be refreshed and is due for it. */
export function isDue(
	config: LibraryConfig,
	entry: LibraryEntry,
	checked: CheckLog,
	now: Date = new Date(),
): boolean {
	return entry.ref !== undefined && overdueBy(config, entry, checked, now) >= 0;
}

/**
 * The notes to ask about this run, longest overdue first.
 *
 * Ordering by how far past due each one is rather than by date is what keeps a
 * thousand notes made on the same afternoon from taking turns forever: the
 * ones whose facts move fastest come round again soonest.
 */
export function dueEntries(
	entries: readonly LibraryEntry[],
	config: LibraryConfig,
	checked: CheckLog,
	now: Date = new Date(),
	limit = Number.MAX_SAFE_INTEGER,
): LibraryEntry[] {
	return entries
		.filter((entry) => isDue(config, entry, checked, now))
		.sort(
			(a, b) =>
				overdueBy(config, b, checked, now) -
				overdueBy(config, a, checked, now),
		)
		.slice(0, Math.max(0, limit));
}

/** Every note a source could be asked about, due or not. */
export function refreshable(entries: readonly LibraryEntry[]): LibraryEntry[] {
	return entries.filter((entry) => entry.ref !== undefined);
}

/** Drops paths for notes that no longer exist, so the log cannot grow forever. */
export function pruneCheckLog(
	checked: CheckLog,
	entries: readonly LibraryEntry[],
): Record<string, string> {
	const alive = new Set(entries.map((entry) => entry.path));
	const out: Record<string, string> = {};
	for (const [path, day] of Object.entries(checked)) {
		if (alive.has(path)) out[path] = day;
	}
	return out;
}
