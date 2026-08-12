import type { ProviderTraits, TermRef } from "../provider";
import type { MediaRef } from "../types";
import type { LibraryConfig } from "./config";
import type { LibraryEntry } from "./entry";
import { feedbackKey, type FeedbackLog } from "./feedback";
import { seedStrength } from "./recommend";

/**
 * What Scout has found out about the things in your library, and when to go
 * and find out more.
 *
 * Everything here is policy and no part of it touches a network or reads a
 * clock it was not handed. `enricher.ts` is the half that does.
 *
 * The cache is Scout's own working notes. **Nothing here is ever written back
 * into a note** — not as frontmatter, not as a tag, not ever. The keywords
 * behind a film are how the model thinks; they are not something anybody asked
 * to have appear in their vault, and `refreshPatch` must never learn about
 * them. That boundary is a deliberate one and there is a test holding it.
 */

/**
 * Bumped when the shape of a harvest changes.
 *
 * Lets a later version go back for what it now knows to ask for, without
 * throwing away everything already gathered.
 */
export const ENRICH_VERSION = 1;

export interface EnrichmentRecord {
	v: number;
	/** Epoch milliseconds of the harvest. */
	at: number;
	keywords: TermRef[];
	people: TermRef[];
	directors: TermRef[];
	studios: string[];
	series?: { id: string; name: string; total?: number };
	language?: string;
	runtime?: number;
	/** Siblings, as `providerId:id`. */
	related?: string[];
	/** The source answered and had nothing. Stops it being asked every run. */
	empty?: true;
}

/**
 * Keyed the same way feedback is, so the record for a suggestion you thumbed
 * up and the record for the note you later made from it are one record.
 */
export type EnrichmentCache = Record<string, EnrichmentRecord>;

const DAY = 24 * 60 * 60 * 1000;

/** How long a harvest stands before it is worth asking again. */
export const STALE_AFTER_DAYS = 180;

/** And how long a "there was nothing" stands, which is much longer. */
export const EMPTY_STANDS_DAYS = 365;

const cap = <T>(list: readonly T[] | undefined, most: number): T[] =>
	(list ?? []).slice(0, most);

export function recordOf(
	traits: ProviderTraits | null,
	now: Date = new Date(),
): EnrichmentRecord {
	const empty =
		!traits ||
		((traits.keywords?.length ?? 0) === 0 &&
			(traits.people?.length ?? 0) === 0 &&
			(traits.directors?.length ?? 0) === 0 &&
			(traits.studios?.length ?? 0) === 0 &&
			!traits.series &&
			!traits.language &&
			!traits.runtime);

	return {
		v: ENRICH_VERSION,
		at: now.getTime(),
		keywords: cap(traits?.keywords, 12),
		people: cap(traits?.people, 8),
		directors: cap(traits?.directors, 3),
		studios: cap(traits?.studios, 2),
		...(traits?.series ? { series: traits.series } : {}),
		...(traits?.language ? { language: traits.language } : {}),
		...(traits?.runtime ? { runtime: traits.runtime } : {}),
		...(traits?.related?.length
			? { related: cap(traits.related.map(feedbackKey), 8) }
			: {}),
		...(empty ? { empty: true as const } : {}),
	};
}

/** Reads a stored blob defensively — this is hand-editable plugin data. */
export function normalizeEnrichment(raw: unknown): EnrichmentCache {
	if (!raw || typeof raw !== "object") return {};
	const out: EnrichmentCache = {};

	const terms = (from: unknown): TermRef[] => {
		if (!Array.isArray(from)) return [];
		const list: TermRef[] = [];
		for (const one of from) {
			if (typeof one === "string") list.push({ name: one });
			else if (one && typeof one === "object" && typeof one.name === "string") {
				list.push({
					name: one.name,
					...(typeof one.id === "string" ? { id: one.id } : {}),
				});
			}
		}
		return list;
	};
	const strings = (from: unknown): string[] =>
		Array.isArray(from) ? from.filter((one) => typeof one === "string") : [];

	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!value || typeof value !== "object") continue;
		const at = value as Partial<EnrichmentRecord>;
		if (typeof at.at !== "number") continue;
		out[key] = {
			v: typeof at.v === "number" ? at.v : 0,
			at: at.at,
			keywords: terms(at.keywords),
			people: terms(at.people),
			directors: terms(at.directors),
			studios: strings(at.studios),
			...(at.series && typeof at.series.id === "string"
				? { series: at.series }
				: {}),
			...(typeof at.language === "string" ? { language: at.language } : {}),
			...(typeof at.runtime === "number" ? { runtime: at.runtime } : {}),
			...(Array.isArray(at.related) ? { related: strings(at.related) } : {}),
			...(at.empty ? { empty: true as const } : {}),
		};
	}
	return out;
}

/** Whether what is on file about this is still worth believing. */
export function isFresh(
	record: EnrichmentRecord | undefined,
	now: Date,
): boolean {
	if (!record) return false;
	if (record.v !== ENRICH_VERSION) return false;
	const age = now.getTime() - record.at;
	return record.empty
		? age < EMPTY_STANDS_DAYS * DAY
		: age < STALE_AFTER_DAYS * DAY;
}

/**
 * What to go and ask about next, best use of the budget first.
 *
 * Recomputed from scratch every run rather than walked with a cursor, which is
 * what makes this resumable for free: a crash, a quit, a changed setting or a
 * note deleted mid-run all cost nothing, because there is no position to lose.
 *
 * The order is the whole design. A budget spent alphabetically would take
 * weeks to reach anything the row actually uses; spent on the titles that seed
 * the recommendations, the first run already improves what you see.
 */
export function dueForEnrichment(
	config: LibraryConfig,
	entries: readonly LibraryEntry[],
	cache: Readonly<EnrichmentCache>,
	canAsk: (ref: MediaRef) => boolean,
	now: Date = new Date(),
	budget = 15,
): MediaRef[] {
	if (budget <= 0) return [];
	const year = now.getTime() - 365 * DAY;

	const waiting: { ref: MediaRef; rank: number }[] = [];
	for (const entry of entries) {
		const ref = entry.ref;
		if (!ref || !canAsk(ref)) continue;
		if (isFresh(cache[feedbackKey(ref)], now)) continue;

		// 0: drives the row directly. 1: you plainly care about it. 2: the rest.
		const strength = seedStrength(config, entry, now);
		const finished = entry.finished ? Date.parse(entry.finished) : NaN;
		const rank =
			strength !== null
				? -strength
				: entry.favorite || (Number.isFinite(finished) && finished > year)
					? 10
					: 20 + entry.created / 1e15;
		waiting.push({ ref, rank });
	}

	waiting.sort((a, b) => a.rank - b.rank);
	return waiting.slice(0, budget).map((one) => one.ref);
}

/** How many notes could ever be enriched, and how many still want it. */
export function enrichmentProgress(
	config: LibraryConfig,
	entries: readonly LibraryEntry[],
	cache: Readonly<EnrichmentCache>,
	canAsk: (ref: MediaRef) => boolean,
	now: Date = new Date(),
): { eligible: number; known: number; waiting: number } {
	let eligible = 0;
	let known = 0;
	for (const entry of entries) {
		const ref = entry.ref;
		if (!ref || !canAsk(ref)) continue;
		eligible += 1;
		if (isFresh(cache[feedbackKey(ref)], now)) known += 1;
	}
	return { eligible, known, waiting: eligible - known };
}

/**
 * Forgets what is no longer about anything, then the oldest.
 *
 * A record roughly two hundred bytes, so a full cache on a large library is
 * about the size of the check log that already sits beside it.
 */
export function pruneEnrichment(
	cache: Readonly<EnrichmentCache>,
	entries: readonly LibraryEntry[],
	feedback: Readonly<FeedbackLog>,
	max = 600,
): EnrichmentCache {
	const wanted = new Set<string>(Object.keys(feedback));
	for (const entry of entries) {
		if (entry.ref) wanted.add(feedbackKey(entry.ref));
	}

	const kept = Object.entries(cache).filter(([key]) => wanted.has(key));
	if (kept.length <= max) return Object.fromEntries(kept);
	kept.sort((a, b) => b[1].at - a[1].at);
	return Object.fromEntries(kept.slice(0, max));
}
