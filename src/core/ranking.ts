import type { MediaItem } from "./types";

/**
 * Relevance ranking for merged search results.
 *
 * Providers each return their own idea of "best match" — TMDB's multi-search
 * leans on popularity, Open Library's on text matching, AniList's on
 * `SEARCH_MATCH` — and simply concatenating those lists put obscure items above
 * the thing the user obviously meant. This scores every result on the same
 * scale so the merged list makes sense, and drops the long tail of near-misses.
 *
 * Nothing here knows about a specific provider: the only inputs are the
 * normalized `MediaItem` fields.
 */

const WEIGHTS = {
	title: 0.6,
	popularity: 0.22,
	rating: 0.12,
	completeness: 0.06,
} as const;

/** Results that always survive filtering, so a niche search is never emptied. */
const ALWAYS_KEEP = 5;

/** Ratings from few voters are noisy; this is the half-trust point. */
const RATING_CONFIDENCE_MIDPOINT = 50;

/** Assumed confidence when a provider reports a rating but no vote count. */
const UNKNOWN_VOTE_CONFIDENCE = 0.35;

export interface ScoreBreakdown {
	title: number;
	popularity: number;
	rating: number;
	completeness: number;
}

export interface RankedItem {
	item: MediaItem;
	score: number;
	parts: ScoreBreakdown;
	/** Title matches the query outright, and the item is not an obscurity. */
	exact: boolean;
}

/** Case, accent, and punctuation insensitive form used for every comparison. */
function normalize(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFKD")
		// Drop the combining marks NFKD just split off, so "Amélie" collapses to
		// "amelie" rather than breaking into two words.
		.replace(/\p{Mark}+/gu, "")
		.replace(/[^\p{Letter}\p{Number}]+/gu, " ")
		.trim()
		.replace(/\s+/g, " ");
}

function words(text: string): string[] {
	return text ? text.split(" ") : [];
}

/**
 * How well a single string answers the query, from 0 (unrelated) to 1 (exact).
 *
 * The bands are deliberately far apart: an exact title must always outrank a
 * merely popular partial match, which is the failure the old ordering had.
 */
export function titleScore(query: string, candidate: string): number {
	const q = normalize(query);
	const t = normalize(candidate);
	if (!q || !t) return 0;
	if (t === q) return 1;

	// "good boy" for "Good Boy: The Movie" — the query is the head of the title.
	if (t.startsWith(q)) return 0.8 + 0.15 * (q.length / t.length);

	const queryWords = words(q);
	const titleWords = words(t);

	const whole = queryWords.filter((w) => titleWords.includes(w)).length;
	if (whole === queryWords.length) {
		// Every query word appears; fewer extra words means a tighter match.
		return 0.6 + 0.15 * (queryWords.length / titleWords.length);
	}

	if (t.includes(q)) return 0.55;

	const partial = queryWords.filter((w) =>
		titleWords.some((tw) => tw.startsWith(w)),
	).length;
	return partial > 0 ? 0.4 * (partial / queryWords.length) : 0;
}

/** Best of title and subtitle, the latter discounted. */
function textScore(query: string, item: MediaItem): number {
	const primary = titleScore(query, item.title);
	const secondary = item.subtitle
		? titleScore(query, item.subtitle) * 0.85
		: 0;
	return Math.max(primary, secondary);
}

/**
 * Popularity is normalized *per provider*: TMDB's scale (a float in the tens)
 * and Open Library's (a raw ratings count in the thousands) are not comparable,
 * so cross-normalizing them would let one source dominate the merged list.
 */
function popularityScorer(items: readonly MediaItem[]): (i: MediaItem) => number {
	const peak = new Map<string, number>();
	for (const item of items) {
		const value = rawPopularity(item);
		if (value > 0) {
			peak.set(
				item.ref.providerId,
				Math.max(peak.get(item.ref.providerId) ?? 0, value),
			);
		}
	}

	return (item) => {
		const value = rawPopularity(item);
		const max = peak.get(item.ref.providerId) ?? 0;
		if (value <= 0 || max <= 0) return 0;
		// Log scale: the gap between a blockbuster and a hit matters far less
		// than the gap between a hit and something nobody has heard of.
		return Math.log10(1 + value) / Math.log10(1 + max);
	};
}

/**
 * How many people know this thing, all-time.
 *
 * Vote count comes first on purpose. TMDB's `popularity` is a *trending*
 * metric that decays, so a forgettable new release outscores a beloved
 * twenty-year-old film — which is exactly how obscure titles were surfacing
 * above the ones people mean. Vote count does not decay. `popularity` stays as
 * the fallback for items that have no votes yet.
 */
function rawPopularity(item: MediaItem): number {
	if (item.ratingCount && item.ratingCount > 0) return item.ratingCount;
	return item.popularity ?? 0;
}

function ratingScore(item: MediaItem): number {
	if (typeof item.rating !== "number") return 0;
	const votes = item.ratingCount ?? 0;
	const confidence =
		votes > 0
			? votes / (votes + RATING_CONFIDENCE_MIDPOINT)
			: UNKNOWN_VOTE_CONFIDENCE;
	return (item.rating / 10) * confidence;
}

/** Providers substitute a "no image" data URI, which is not real artwork. */
function hasArtwork(item: MediaItem): boolean {
	const url = item.thumbnailUrl ?? item.imageUrl;
	return Boolean(url) && !url!.startsWith("data:");
}

function completenessScore(item: MediaItem): number {
	return (hasArtwork(item) ? 0.5 : 0) + (item.description ? 0.5 : 0);
}

/** Scores every item without reordering or dropping anything. */
export function scoreResults(
	items: readonly MediaItem[],
	query: string,
): RankedItem[] {
	const popularity = popularityScorer(items);
	return items.map((item) => {
		const parts: ScoreBreakdown = {
			title: textScore(query, item),
			popularity: popularity(item),
			rating: ratingScore(item),
			completeness: completenessScore(item),
		};
		const score =
			parts.title * WEIGHTS.title +
			parts.popularity * WEIGHTS.popularity +
			parts.rating * WEIGHTS.rating +
			parts.completeness * WEIGHTS.completeness;
		// Set by `rankResults`, which can see the whole set's popularity spread.
		return { item, score, parts, exact: false };
	});
}

/**
 * Anything that neither matches the query nor has an audience. Kept strict on
 * purpose — filtering is only worth doing when it cannot hide a real answer.
 */
function isNoise(ranked: RankedItem): boolean {
	if (ranked.parts.title === 0) return true;
	return (
		ranked.parts.title < 0.5 &&
		ranked.parts.popularity < 0.05 &&
		ranked.parts.rating === 0
	);
}

/**
 * A title that *is* the query outranks near-misses however popular they are —
 * a blended score alone let the better-known "Good Boys" sit above the "Good
 * Boy" that was actually typed. Popularity and rating then order the items
 * within each of the two groups.
 */
const EXACT_TITLE = 0.95;

/**
 * …but only for an exact match with some audience behind it.
 *
 * Unconditional pinning is wrong in the other direction: searching a series
 * name matches every entry as a *prefix*, never as an exact title, so one
 * obscure item carrying the bare series name ("Harry Potter") jumped the whole
 * film series. An exact title in the bottom of the popularity distribution
 * competes on its blended score like anything else. Ignored when no result in
 * the set reports popularity, since then there is nothing to judge it against.
 */
const EXACT_MIN_POPULARITY = 0.35;

/* ------------------------------------------------------------------ series */

/**
 * How many entries sharing the query as a title prefix make a series.
 *
 * Two is a sequel and could be a coincidence; three of them almost never is.
 */
const SERIES_MIN = 3;

/**
 * A series entry must have at least this share of its own series' audience.
 *
 * A series name is a prefix magnet: "Harry Potter" also matches making-of
 * documentaries, anniversary specials, and cash-in shorts. Left in, they sort
 * by date into the middle of the run, which is worse than not grouping at all.
 * Compared on the log-normalized scale, so this is a wide band — the tail it
 * cuts is orders of magnitude below the films, not merely less popular.
 */
const SERIES_AUDIENCE_FLOOR = 0.5;

/**
 * How much of the result set's total reach a series needs to be lifted above
 * better-scoring loose results.
 *
 * When someone searches a series name, the series is the answer and belongs at
 * the top whatever its medium. But three obscure study guides sharing a prefix
 * are not what "dune" means, so a weak run stays where it scored instead.
 *
 * Judged on reach measured across *all* providers, unlike the blended score.
 * Per-provider normalization would make three equally-unknown books each look
 * maximally popular — the only openlibrary results in the set — and wave the
 * run straight past the film everyone meant.
 */
const SERIES_MIN_REACH = 0.5;

const ROMAN: Record<string, number> = {
	i: 1,
	ii: 2,
	iii: 3,
	iv: 4,
	v: 5,
	vi: 6,
	vii: 7,
	viii: 8,
	ix: 9,
	x: 10,
};

/** Sortable release key; items with no date sort last within their group. */
function dateKey(item: MediaItem): string {
	return item.releaseDate ?? (item.year ? String(item.year) : "9999");
}

/** "part 2", "iv" — the installment number, where the title states one. */
function installment(title: string, prefix: string): number {
	const rest = normalize(title).slice(prefix.length).trim();
	for (const word of words(rest)) {
		if (/^\d+$/.test(word)) return Number(word);
		const roman = ROMAN[word];
		if (roman !== undefined) return roman;
	}
	return Number.MAX_SAFE_INTEGER;
}

/** The title's words after the searched-for series name. */
function remainderWords(item: MediaItem, prefix: string): string[] {
	return words(normalize(item.title).slice(prefix.length).trim());
}

/**
 * The naming pattern most of a group shares — "and the" for the Harry Potter
 * novels, "episode" for Star Wars — or null when there is no shared pattern.
 *
 * Chosen by how many members it covers, with a longer pattern breaking ties
 * since it describes the same set more precisely. Picking the longest pattern
 * outright would instead single out the sub-run with the most words in common
 * ("and the deathly hallows") and discard the rest of the series.
 */
function dominantPattern(
	members: RankedItem[],
	prefix: string,
): string[] | null {
	const remainders = members.map((m) => remainderWords(m.item, prefix));
	const longest = Math.max(0, ...remainders.map((r) => r.length));
	let best: { pattern: string[]; count: number } | null = null;

	for (let length = 1; length <= longest; length++) {
		const counts = new Map<string, number>();
		for (const remainder of remainders) {
			if (remainder.length < length) continue;
			const candidate = remainder.slice(0, length).join(" ");
			counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
		}
		for (const [candidate, count] of counts) {
			if (!best || count >= best.count) {
				best = { pattern: candidate.split(" "), count };
			}
		}
	}
	return best && best.count >= SERIES_MIN ? best.pattern : null;
}

/**
 * The core of a prefix group: its actual entries, with the long tail of
 * spin-offs dropped so they cannot sort into the middle of the run.
 *
 * Two independent signals, because neither covers every source. Audience needs
 * rating counts, which Open Library mostly does not have — that gap is why the
 * films came out in order and the books came out with companions and cookbooks
 * scattered through them. The naming pattern needs no metadata at all.
 */
function seriesCore(members: RankedItem[], prefix: string): RankedItem[] {
	const pattern = dominantPattern(members, prefix);
	const matching = pattern
		? members.filter((m) => {
				const remainder = remainderWords(m.item, prefix);
				return pattern.every((word, i) => remainder[i] === word);
			})
		: members;

	const top = Math.max(...matching.map((m) => m.parts.popularity));
	// No audience data anywhere in the group, so the pattern is all there is.
	if (top <= 0) return matching;
	return matching.filter(
		(m) => m.parts.popularity >= top * SERIES_AUDIENCE_FLOOR,
	);
}

/**
 * Gathers series entries into chronological blocks and lifts them to the top.
 *
 * Searching "harry potter" should answer with the series, in order, films and
 * books and all — the ordering *is* the information, and a loose result that
 * happens to score well should not sit above or inside it. Blocks are grouped
 * by provider and kind so one chronology is not interleaved with another, then
 * emitted strongest-first ahead of everything that is not part of a series.
 *
 * A weak run is left where it scored instead, so three obscure titles sharing a
 * prefix cannot displace the popular thing the query actually named.
 */
function orderSeries(ranked: RankedItem[], query: string): RankedItem[] {
	const prefix = normalize(query);
	if (!prefix) return ranked;

	const groupKey = (entry: RankedItem): string | null =>
		// The entry must extend the query, not equal it: a title that *is* the
		// query is the series itself, and stays pinned where it ranked.
		!entry.exact && normalize(entry.item.title).startsWith(`${prefix} `)
			? `${entry.item.ref.providerId}:${entry.item.ref.kind}`
			: null;

	const groups = new Map<string, RankedItem[]>();
	for (const entry of ranked) {
		const key = groupKey(entry);
		if (!key) continue;
		const members = groups.get(key);
		if (members) members.push(entry);
		else groups.set(key, [entry]);
	}

	// Audience counts *are* comparable across providers — a TMDB vote and a
	// Goodreads rating are both one person — so unlike the blended score, this
	// can be normalized over the whole set.
	const peak = Math.max(0, ...ranked.map((r) => rawPopularity(r.item)));
	const reach = (r: RankedItem) =>
		peak <= 0
			? 1 // No audience data anywhere; nothing to judge the run against.
			: Math.log10(1 + rawPopularity(r.item)) / Math.log10(1 + peak);

	const hoisted: { best: number; block: RankedItem[] }[] = [];
	const inPlace = new Map<string, RankedItem[]>();
	const grouped = new Set<RankedItem>();

	for (const [key, members] of groups) {
		const core = seriesCore(members, prefix);
		if (core.length < SERIES_MIN) continue;
		const best = Math.max(...core.map((m) => m.score));
		const strong = Math.max(...core.map(reach)) >= SERIES_MIN_REACH;
		core.sort(
			(a, b) =>
				dateKey(a.item).localeCompare(dateKey(b.item)) ||
				installment(a.item.title, prefix) -
					installment(b.item.title, prefix) ||
				a.item.title.localeCompare(b.item.title),
		);
		for (const member of core) grouped.add(member);
		if (strong) hoisted.push({ best, block: core });
		else inPlace.set(key, core);
	}
	if (hoisted.length === 0 && inPlace.size === 0) return ranked;

	// Strongest series first when a query matches more than one.
	hoisted.sort((a, b) => b.best - a.best);

	const emitted = new Set<string>();
	const rest: RankedItem[] = [];
	for (const entry of ranked) {
		const key = groupKey(entry);
		const block = key ? inPlace.get(key) : undefined;
		if (block) {
			if (!emitted.has(key!)) {
				emitted.add(key!);
				rest.push(...block);
			}
			continue;
		}
		// Trimmed-off tail members fall back to their own scored position.
		if (!grouped.has(entry)) rest.push(entry);
	}

	const pinned = rest.filter((r) => r.exact);
	return [
		...pinned,
		...hoisted.flatMap((h) => h.block),
		...rest.filter((r) => !r.exact),
	];
}

/** Sorted best-first, with the obvious non-answers removed. */
export function rankResults(
	items: readonly MediaItem[],
	query: string,
): MediaItem[] {
	const scored = scoreResults(items, query);
	const rankedByPopularity = scored.some((s) => s.parts.popularity > 0);
	for (const entry of scored) {
		entry.exact =
			entry.parts.title >= EXACT_TITLE &&
			(!rankedByPopularity ||
				entry.parts.popularity >= EXACT_MIN_POPULARITY);
	}
	scored.sort(
		(a, b) =>
			Number(b.exact) - Number(a.exact) ||
			b.score - a.score ||
			(b.item.year ?? 0) - (a.item.year ?? 0),
	);
	if (!query.trim()) return scored.map((s) => s.item);
	const kept = scored.filter((s, index) => index < ALWAYS_KEEP || !isNoise(s));
	return orderSeries(kept, query).map((s) => s.item);
}
