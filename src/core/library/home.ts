import { MEDIA_KIND_LABELS, type MediaKind } from "../types";
import {
	ratingFraction,
	statusTone,
	type LibraryConfig,
	type StatusTone,
} from "./config";
import type { LibraryEntry } from "./entry";
import { releaseCountdown } from "./release";
import {
	candidateOf,
	rankDiverse,
	scoreCandidate,
	type TasteProfile,
} from "./taste";

/**
 * What the hub shows, worked out from the library alone.
 *
 * Every section here is free — no request goes out to build any of it — and
 * every section is allowed to be empty. A hub is only useful if it reshapes
 * itself around what you are actually doing: a library of nothing but books
 * should never show a row headed "Continue watching", and someone with nothing
 * on the go should get their shelf of unstarted things at the top instead of an
 * empty box where the interesting row would have been.
 */

/**
 * How many entries any one row carries.
 *
 * Seven, because that is what a rail can show across at its widest. A row is a
 * row: eight meant seven cards and one on a line by itself, which reads as the
 * beginning of a list that was cut off rather than as a shelf.
 */
const ROW = 7;

/** Days ahead that still counts as "soon" for the coming-up row. */
const SOON_DAYS = 400;

export interface HomeSummary {
	total: number;
	onTheGo: number;
	planned: number;
	finished: number;
	/** Finished with a date in the current calendar year. */
	finishedThisYear: number;
	/** Average of every rating, as a fraction, across scales. */
	averageFraction: number | null;
	byKind: { kind: MediaKind; label: string; count: number }[];
	/** The kind you keep most of — what the greeting's verb is chosen from. */
	dominant?: MediaKind;
}

export interface HomeUpcoming {
	entry: LibraryEntry;
	/** "In 9 days", "Out in March" — already worded. */
	when: string;
}

export interface HomeData {
	summary: HomeSummary;
	/** Started and not finished, the one you touched last at the front. */
	continuing: LibraryEntry[];
	/** On the shelf, unstarted, ranked by what this library says you like. */
	upNext: LibraryEntry[];
	/** Set aside rather than dropped — worth an occasional nudge. */
	onHold: LibraryEntry[];
	/** Not out yet, soonest first. */
	upcoming: HomeUpcoming[];
	/** Most recently finished, with whatever you made of them. */
	recent: LibraryEntry[];
	/** Your own highest, across every scale. */
	best: LibraryEntry[];
	/** Genres this library leans on, strongest first. */
	topGenres: { name: string; count: number }[];
}

const lower = (value: string) => value.trim().toLowerCase();

/** The day something last moved, for ordering "what am I in the middle of". */
function lastTouched(entry: LibraryEntry): number {
	const started = entry.started ? Date.parse(entry.started) : NaN;
	return Math.max(
		Number.isFinite(started) ? started : 0,
		entry.modified,
		entry.created,
	);
}

function finishedAt(entry: LibraryEntry): number {
	const at = entry.finished ? Date.parse(entry.finished) : NaN;
	return Number.isFinite(at) ? at : entry.modified;
}

/**
 * Days until release, or null for anything already out or undated.
 *
 * Parsing rather than reusing `releaseCountdown`'s wording, because ordering
 * the row needs a number and the row's labels need the words.
 */
function daysUntil(raw: string | undefined, now: Date): number | null {
	if (!raw) return null;
	const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(raw.trim());
	if (!match?.[1]) return null;
	const year = Number(match[1]);
	const month = match[2] ? Number(match[2]) - 1 : 11;
	const day = match[3] ? Number(match[3]) : 28;
	const at = new Date(year, month, day).getTime();
	const today = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
	).getTime();
	const days = Math.round((at - today) / 86_400_000);
	return days >= 0 ? days : null;
}

export function buildHome(
	config: LibraryConfig,
	entries: readonly LibraryEntry[],
	profile: TasteProfile,
	now: Date = new Date(),
): HomeData {
	// A note with no status at all is one you have not started, same as one
	// shelved under "To watch" — the hub should offer it, not lose it.
	const byTone = new Map<StatusTone, LibraryEntry[]>();
	for (const entry of entries) {
		const tone = statusTone(config, entry.status) ?? "planned";
		const list = byTone.get(tone) ?? [];
		list.push(entry);
		byTone.set(tone, list);
	}
	const of = (tone: StatusTone) => byTone.get(tone) ?? [];

	const continuing = [...of("active")]
		.sort((a, b) => lastTouched(b) - lastTouched(a))
		.slice(0, ROW);

	const onHold = [...of("paused")]
		.sort((a, b) => lastTouched(b) - lastTouched(a))
		.slice(0, ROW);

	// Ranked by taste rather than by title, because "what should I start" is the
	// question a shelf of forty unstarted things cannot answer by itself.
	const planned = of("planned").filter(
		(entry) => daysUntil(entry.releaseDate, now) === null,
	);
	const upNext = rankDiverse(
		planned,
		(entry) => ({
			score: scoreCandidate(profile, candidateOf(entry), now).score,
			tags: entry.tags,
		}),
		ROW,
	);

	const upcoming: HomeUpcoming[] = entries
		.map((entry) => ({ entry, days: daysUntil(entry.releaseDate, now) }))
		.filter(
			(at): at is { entry: LibraryEntry; days: number } =>
				at.days !== null && at.days <= SOON_DAYS,
		)
		.sort((a, b) => a.days - b.days)
		.slice(0, ROW)
		.map(({ entry }) => ({
			entry,
			when: releaseCountdown(entry.releaseDate, now) ?? "Coming soon",
		}));

	const recent = [...of("done")]
		.sort((a, b) => finishedAt(b) - finishedAt(a))
		.slice(0, ROW);

	const best = entries
		.map((entry) => ({
			entry,
			fraction: ratingFraction(config, entry.kind, entry.rating),
		}))
		.filter(
			(at): at is { entry: LibraryEntry; fraction: number } =>
				at.fraction !== undefined,
		)
		.sort(
			(a, b) =>
				b.fraction - a.fraction ||
				finishedAt(b.entry) - finishedAt(a.entry),
		)
		.slice(0, ROW)
		.map((at) => at.entry);

	return {
		summary: summarize(config, entries, now),
		continuing,
		upNext,
		onHold,
		upcoming,
		recent,
		best,
		topGenres: topGenres(entries),
	};
}

function summarize(
	config: LibraryConfig,
	entries: readonly LibraryEntry[],
	now: Date,
): HomeSummary {
	const counts = new Map<MediaKind, number>();
	let onTheGo = 0;
	let planned = 0;
	let finished = 0;
	let finishedThisYear = 0;
	let ratingSum = 0;
	let rated = 0;

	for (const entry of entries) {
		counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
		const tone = statusTone(config, entry.status);
		if (tone === "active") onTheGo++;
		if (tone === "planned") planned++;
		if (tone === "done") {
			finished++;
			// Every finish this year, not only the latest — a book read twice
			// is two finishes, and the year count is a count of finishes.
			for (const date of [...entry.history, entry.finished]) {
				if (date?.startsWith(String(now.getFullYear()))) finishedThisYear++;
			}
		}
		const fraction = ratingFraction(config, entry.kind, entry.rating);
		if (fraction !== undefined) {
			rated++;
			ratingSum += fraction;
		}
	}

	const byKind = [...counts.entries()]
		.map(([kind, count]) => ({
			kind,
			label: MEDIA_KIND_LABELS[kind],
			count,
		}))
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

	return {
		total: entries.length,
		onTheGo,
		planned,
		finished,
		finishedThisYear,
		averageFraction: rated > 0 ? ratingSum / rated : null,
		byKind,
		dominant: byKind[0]?.kind,
	};
}

/** Genres by how much of the library carries them. */
function topGenres(
	entries: readonly LibraryEntry[],
	limit = 6,
): { name: string; count: number }[] {
	const counts = new Map<string, { name: string; count: number }>();
	for (const entry of entries) {
		for (const tag of entry.tags) {
			const name = tag.trim();
			if (!name) continue;
			const at = counts.get(lower(name)) ?? { name, count: 0 };
			at.count++;
			counts.set(lower(name), at);
		}
	}
	return [...counts.values()]
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
		.slice(0, limit);
}

/* Seeds for the recommendation fetch live in `recommend.ts`, alongside the
   rest of the pipeline that consumes them. */
