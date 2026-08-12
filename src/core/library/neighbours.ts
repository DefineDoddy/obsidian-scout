import type { LibraryConfig } from "./config";
import type { LibraryEntry } from "./entry";
import type { FeedbackLog } from "./feedback";
import type { Reason } from "./reasons";
import {
	NAMESPACE_WEIGHT,
	parseTrait,
	traitsOfEntry,
	traitsOfRecord,
	type TraitKey,
	type TraitOptions,
} from "./traits";

/**
 * "Because you liked Arrival."
 *
 * The affinity model is an average: it knows you like science fiction and
 * Villeneuve, and it applies that knowledge to everything equally. What it
 * cannot do is notice that one particular candidate is *the same shape* as one
 * particular thing you said yes to — because by the time a thumbs-up has been
 * folded into a dozen trait averages, the thing itself is gone.
 *
 * This keeps the things themselves. Each anchor is something you actually
 * endorsed: a suggestion you thumbed up, or a note you starred, which is a
 * thumbs-up the vault happened to record first. A candidate is compared
 * against each one as a whole, and the best single match earns a boost.
 *
 * The best rather than the sum, and not only for arithmetic reasons. Summing
 * lets a long feedback log dominate everything and produces a number nobody
 * can account for. The best match has a *name*, and being able to say the name
 * is the entire point.
 */

/** How much of a lift a perfect match is worth. */
const NEIGHBOUR_WEIGHT = 0.45;

/**
 * How alike two things have to be, as a fraction, before it is worth saying.
 */
const NEIGHBOUR_FLOOR = 0.28;

/**
 * And how much they have to actually share, in namespace weight.
 *
 * A ratio on its own is not enough, because a candidate the source said almost
 * nothing about is *mostly* whatever it does say. A record carrying one genre
 * and a year shares half its substance with anything else in that genre, and
 * comes out at a cosine of 0.46 — well clear of the floor above — on the
 * strength of "they are both dramas". Saying "because you liked Arrival" about
 * that is the model overclaiming, and overclaiming costs more trust than
 * staying quiet.
 *
 * Set just above a single genre, so one shared genre is never enough on its
 * own, while a genre and a name, or two genres, is.
 */
const MIN_SHARED = 2.2;

const HALF_LIFE = 2.5;
const MIN_RECENCY = 0.3;

export interface Anchor {
	title: string;
	traits: ReadonlySet<TraitKey>;
	/** Sum of namespace weights across `traits`, precomputed for the cosine. */
	norm: number;
	at: number;
	/** The note it came from, when it came from one. */
	path?: string;
}

const weightOf = (trait: TraitKey): number => {
	const ns = parseTrait(trait)?.ns;
	return (ns && NAMESPACE_WEIGHT[ns]) ?? 1;
};

function anchor(
	title: string,
	traits: readonly TraitKey[],
	at: number,
	path?: string,
): Anchor | null {
	if (traits.length === 0) return null;
	const set = new Set(traits);
	let norm = 0;
	for (const trait of set) norm += weightOf(trait);
	if (norm <= 0) return null;
	return { title, traits: set, norm, at, ...(path ? { path } : {}) };
}

/**
 * Everything you have positively endorsed, as things rather than as averages.
 *
 * Favourites are in here because a favourite is a like the vault recorded
 * before the row existed, and a model that ignored them would be starting from
 * nothing on a library that had been kept for years.
 */
export function anchorsOf(
	config: LibraryConfig,
	entries: readonly LibraryEntry[],
	feedback: Readonly<FeedbackLog>,
	options: TraitOptions = {},
): Anchor[] {
	const out: Anchor[] = [];

	for (const record of Object.values(feedback)) {
		if (record.verdict !== "liked") continue;
		const traits =
			record.traits ?? traitsOfRecord(record).map((one) => one.key);
		const one = anchor(record.title, traits, record.at);
		if (one) out.push(one);
	}

	for (const entry of entries) {
		if (!entry.favorite) continue;
		const traits = traitsOfEntry(entry, options).map((at) => at.key);
		const at = entry.finished ? Date.parse(entry.finished) : entry.created;
		const one = anchor(
			entry.title,
			traits,
			Number.isFinite(at) ? at : entry.created,
			entry.path,
		);
		if (one) out.push(one);
	}

	return out;
}

export interface Neighbour {
	boost: number;
	reason?: Reason;
}

/**
 * The closest thing you have said yes to, and what resembling it is worth.
 *
 * A namespace-weighted cosine over the two trait sets: sharing a director
 * counts for more than sharing a decade, and a candidate listing twenty
 * keywords does not out-match one listing four simply by having more of them.
 */
export function neighbourBoost(
	anchors: readonly Anchor[],
	candidate: readonly TraitKey[],
	now: Date = new Date(),
): Neighbour {
	if (anchors.length === 0 || candidate.length === 0) return { boost: 0 };

	const mine = new Set(candidate);
	let norm = 0;
	for (const trait of mine) norm += weightOf(trait);
	if (norm <= 0) return { boost: 0 };

	let best = 0;
	let bestAnchor: Anchor | null = null;

	for (const one of anchors) {
		let shared = 0;
		// Walk the smaller of the two, since most anchors share nothing at all.
		const [small, large] =
			mine.size < one.traits.size ? [mine, one.traits] : [one.traits, mine];
		for (const trait of small) {
			if (large.has(trait)) shared += weightOf(trait);
		}
		if (shared < MIN_SHARED) continue;

		const similarity = shared / Math.sqrt(norm * one.norm);
		const age = Math.max(
			0,
			(now.getTime() - one.at) / (365.25 * 24 * 3600 * 1000),
		);
		const decayed =
			similarity * Math.max(MIN_RECENCY, 0.5 ** (age / HALF_LIFE));
		if (decayed > best) {
			best = decayed;
			bestAnchor = one;
		}
	}

	if (best < NEIGHBOUR_FLOOR || !bestAnchor) return { boost: 0 };

	return {
		boost: NEIGHBOUR_WEIGHT * best,
		reason: {
			kind: "neighbour",
			label: `Because you liked ${bestAnchor.title}`,
			// The title alone. "Like " spent five of a card's twenty-odd characters
			// saying what the heart beside it already says, and those five
			// characters came off the end of the title — "Like Insidious: The Red
			// I" is a worse sentence than the one it was trying to be.
			short: bestAnchor.title,
			strength: Math.min(1, best),
			...(bestAnchor.path ? { ref: { path: bestAnchor.path } } : {}),
		},
	};
}
