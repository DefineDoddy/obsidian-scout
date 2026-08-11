import type { ScoutContext } from "../context";
import { isAbortError } from "../http";
import { isSearchable, type MediaProvider, type Searchable } from "../provider";
import { titleScore } from "../ranking";
import type { MediaItem } from "../types";
import type { LibraryEntry } from "./entry";

/**
 * Backfilling the source id on notes that have none.
 *
 * The id in a note's frontmatter is the *source's* id — TMDB's number for a
 * film, Open Library's key for a book. Nothing local can invent one, so
 * rebuilding the index cannot fill it in: the value does not exist until
 * somebody asks the source. This does the asking, once, for every note that
 * predates Scout or was written by hand.
 *
 * Conservative, but only where doubt is real. A wrong id is worse than no id —
 * it makes the wrong search result show as owned, and quietly ties a note to
 * the wrong work — so a note is left alone whenever two candidates could
 * genuinely both be it. Two *sources* answering with their own id for the same
 * film is not that case, and treating it as one is what made this find almost
 * nothing.
 */

export interface LinkReport {
	/** Notes that got a source and an id written to them. */
	linked: number;
	/** Notes where the answer was not certain enough to write. */
	skipped: number;
	/** Notes considered in total. */
	total: number;
	/** Titles of the notes that were left alone, for the caller to report. */
	unresolved: string[];
}

/** Release dates drift by a region and by a new year; first-publish years do not. */
const YEAR_SLACK = 1;

/**
 * How far ahead of the runner-up an item must be to settle a tie by itself.
 *
 * Same-titled works are not equally known: an "Arrival" with eight thousand
 * votes beside one with four is not a coin toss. Three-to-one keeps the genuine
 * ambiguities — the 1984 and 2021 "Dune", within striking distance of each
 * other — out of the automatic path.
 */
const DOMINANCE = 3;

/** All-time reach, on whatever scale the provider counts in. */
function audience(item: MediaItem): number {
	return item.ratingCount ?? item.popularity ?? 0;
}

/** The names a note answers to: its title property, and its filename. */
function namesOf(entry: LibraryEntry): string[] {
	return entry.title === entry.basename
		? [entry.title]
		: [entry.title, entry.basename];
}

/**
 * Whether a candidate is the same work, by name alone.
 *
 * `titleScore` returns 1 only for normalized string equality, so this is an
 * exact title match — punctuation, case, and accents aside.
 */
function isSameWork(entry: LibraryEntry, item: MediaItem): boolean {
	if (item.ref.kind !== entry.kind) return false;
	return namesOf(entry).some((name) => titleScore(name, item.title) >= 1);
}

/** The clear front-runner by audience, or nothing when the field is close. */
function dominant(items: MediaItem[]): MediaItem | undefined {
	const sorted = [...items].sort((a, b) => audience(b) - audience(a));
	const best = sorted[0];
	const next = sorted[1];
	if (!best) return undefined;
	if (!next) return best;
	return audience(best) >= Math.max(1, audience(next) * DOMINANCE)
		? best
		: undefined;
}

/**
 * The one item a single source is sure the note means, or nothing.
 *
 * Kept per-source on purpose: two sources each returning their own id for the
 * same film is agreement, not ambiguity, and the ids are not comparable across
 * sources in the first place.
 */
export function certainMatch(
	entry: LibraryEntry,
	candidates: readonly MediaItem[],
): MediaItem | undefined {
	const exact = candidates.filter((item) => isSameWork(entry, item));
	if (exact.length <= 1) return exact[0];

	if (entry.year !== undefined) {
		const year = entry.year;
		const dated = exact.filter(
			(item) =>
				item.year !== undefined && Math.abs(item.year - year) <= YEAR_SLACK,
		);
		// Nothing of that name from that year: the note means something this
		// source is not offering, whatever else shares the title.
		if (dated.length === 0) return undefined;
		return dated.length === 1 ? dated[0] : dominant(dated);
	}

	// Nothing but the title to go on, so the field has to settle it — which for
	// two comparably known works of the same name it cannot.
	return dominant(exact);
}

/** Sources that could answer for this kind, in registration order. */
function sourcesFor(
	ctx: ScoutContext,
	entry: LibraryEntry,
): (MediaProvider & Searchable)[] {
	return ctx.registry
		// Configured, not merely present: a source missing its API key answers
		// every search with an error, and a run of those looks like no match.
		.configured()
		.filter((p) => ctx.settings.isProviderEnabled(p.id))
		.filter(isSearchable)
		.filter((p) => p.kinds.includes(entry.kind));
}

/**
 * Asks every source at once and takes the first that is certain.
 *
 * Order is the registration order, which is also the order sources appear in
 * settings — so when two sources both know the item, the answer is stable
 * rather than whichever replied first.
 */
async function findMatch(
	ctx: ScoutContext,
	entry: LibraryEntry,
	signal: AbortSignal,
): Promise<MediaItem | undefined> {
	const sources = sourcesFor(ctx, entry);
	if (sources.length === 0) return undefined;

	const settled = await Promise.allSettled(
		sources.map((p) =>
			// One source failing must not take the others down with it.
			p.search(entry.title, { signal, kind: entry.kind }),
		),
	);

	for (const result of settled) {
		if (result.status !== "fulfilled") continue;
		const winner = certainMatch(entry, result.value);
		if (winner) return winner;
	}
	return undefined;
}

/**
 * Links every entry lacking a ref, writing `provider` and `id` where the match
 * is unambiguous. `onProgress` runs after each note so a caller can report.
 */
export async function linkEntriesToSources(
	ctx: ScoutContext,
	signal: AbortSignal,
	onProgress?: (done: number, total: number) => void,
): Promise<LinkReport> {
	const pending = ctx.library.all().filter((entry) => !entry.ref);
	const report: LinkReport = {
		linked: 0,
		skipped: 0,
		total: pending.length,
		unresolved: [],
	};

	for (const [index, entry] of pending.entries()) {
		if (signal.aborted) break;
		try {
			const winner = await findMatch(ctx, entry, signal);
			if (!winner) {
				report.skipped++;
				report.unresolved.push(entry.title);
			} else {
				await ctx.mutator.setField(
					entry,
					"provider",
					winner.ref.providerId,
				);
				await ctx.mutator.setField(entry, "id", winner.ref.id);
				report.linked++;
			}
		} catch (err) {
			if (isAbortError(err)) break;
			console.warn("Scout: could not link", entry.path, err);
			report.skipped++;
			report.unresolved.push(entry.title);
		}
		onProgress?.(index + 1, pending.length);
	}

	if (report.unresolved.length > 0) {
		// Named rather than counted: the fix for each of these is a human
		// looking at the note, and a number gives them nothing to look at.
		console.info(
			"Scout: no certain source match for these notes:",
			report.unresolved,
		);
	}
	return report;
}
