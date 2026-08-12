import { sourceKey, type MediaItem, type MediaKind, type MediaRef } from "../types";
import { traitsOfItem, type TraitKey } from "./traits";

/**
 * What you made of a suggestion, and what the row has already shown you.
 *
 * The one thing a media tracker cannot learn from the vault. Everything else
 * the recommender knows comes from notes — ratings, finishes, drops — and all
 * of it is about things you already chose. A suggestion you glance at and pass
 * on is the only record of something the model got *wrong*, and without it a
 * recommender can be told what you like but never what it keeps mistaking for
 * what you like. Kept in plugin data rather than in the vault, because a note
 * per thing you did not want is a vault full of things you did not want.
 *
 * Two verdicts were not enough, and the gap did real damage. There was no way
 * to say "I have already seen this" — the only button that cleared something
 * off the row was thumbs-down, so every time somebody used it to mean "seen
 * it" they taught the model the exact opposite of the truth. And there was no
 * way to say "not tonight" short of rejecting a thing outright.
 */

export type FeedbackVerdict = "liked" | "disliked" | "seen" | "snoozed";

export interface FeedbackRecord {
	verdict: FeedbackVerdict;
	/** Epoch milliseconds — feedback decays like any other signal. */
	at: number;
	/** When a snooze runs out. Absent means it never does. */
	until?: number;
	kind: MediaKind;
	/** Kept so the model still works when the suggestion is long out of cache. */
	title: string;
	tags: string[];
	people: string[];
	/**
	 * Worked out at the moment you voted, so the record keeps its meaning even
	 * once nothing anywhere remembers this title. Absent on records written
	 * before traits existed, which fall back to `tags` and `people`.
	 */
	traits?: TraitKey[];
	/** So something you liked can become a question to ask the source. */
	ref?: MediaRef;
}

/** Keyed by `providerId:id`, the same key the suggestion rows use. */
export type FeedbackLog = Record<string, FeedbackRecord>;

/**
 * When each suggestion was last put in front of you.
 *
 * The row used to hold this in a `useRef(new Set())` that was never persisted,
 * so closing Obsidian and opening it again brought back the same seven titles
 * — which reads as "this thing is not learning" more loudly than any ranking
 * error ever could.
 */
export type ShownLog = Record<string, number>;

/** How many rows back the log remembers before it starts forgetting. */
export const SHOWN_MAX = 400;

/** The same key `sourceKey` makes, under the name the rows have always used. */
export const feedbackKey = sourceKey;

/** A snooze, in days, when the menu does not say otherwise. */
export const SNOOZE_DAYS = 30;

const DAY = 24 * 60 * 60 * 1000;

export function recordFor(
	item: MediaItem,
	verdict: FeedbackVerdict,
	now: Date = new Date(),
): FeedbackRecord {
	return {
		verdict,
		at: now.getTime(),
		...(verdict === "snoozed"
			? { until: now.getTime() + SNOOZE_DAYS * DAY }
			: {}),
		kind: item.ref.kind,
		title: item.title,
		// Trimmed hard: a cast list of ten from one thumbs-up would swamp the
		// people the library itself learned, which are backed by whole viewings.
		tags: item.tags.slice(0, 6),
		people: item.people.slice(0, 3),
		traits: traitsOfItem(item)
			.slice(0, 14)
			.map((one) => one.key),
		ref: item.ref,
	};
}

/**
 * The verdict as it stands right now, or null for one that has run out.
 *
 * Expiry read here rather than swept by a timer: a snooze that ends while
 * Obsidian is closed has still ended, and nothing has to be running for that to
 * be true.
 */
export function activeVerdict(
	record: FeedbackRecord | undefined,
	now: Date = new Date(),
): FeedbackVerdict | null {
	if (!record) return null;
	if (record.until !== undefined && record.until <= now.getTime()) return null;
	return record.verdict;
}

/** Verdicts that take something off the row for good. */
export function isRefusal(verdict: FeedbackVerdict): boolean {
	return verdict === "disliked" || verdict === "seen";
}

const VERDICTS = new Set<FeedbackVerdict>([
	"liked",
	"disliked",
	"seen",
	"snoozed",
]);

/** Reads a stored blob defensively — this file is hand-editable plugin data. */
export function normalizeFeedback(raw: unknown): FeedbackLog {
	if (!raw || typeof raw !== "object") return {};
	const out: FeedbackLog = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!value || typeof value !== "object") continue;
		const at = value as Partial<FeedbackRecord>;
		if (!at.verdict || !VERDICTS.has(at.verdict)) continue;
		const list = (from: unknown): string[] =>
			Array.isArray(from) ? from.filter((one) => typeof one === "string") : [];
		out[key] = {
			verdict: at.verdict,
			at: typeof at.at === "number" ? at.at : Date.now(),
			...(typeof at.until === "number" ? { until: at.until } : {}),
			kind: (at.kind ?? "movie") as MediaKind,
			title: typeof at.title === "string" ? at.title : key,
			tags: list(at.tags),
			people: list(at.people),
			...(Array.isArray(at.traits)
				? { traits: list(at.traits) as TraitKey[] }
				: {}),
			...(at.ref && typeof at.ref === "object" ? { ref: at.ref } : {}),
		};
	}
	return out;
}

export function normalizeShown(raw: unknown): ShownLog {
	if (!raw || typeof raw !== "object") return {};
	const out: ShownLog = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
	}
	return out;
}

export function countVerdicts(log: FeedbackLog): Record<FeedbackVerdict, number> {
	const out: Record<FeedbackVerdict, number> = {
		liked: 0,
		disliked: 0,
		seen: 0,
		snoozed: 0,
	};
	for (const record of Object.values(log)) out[record.verdict] += 1;
	return out;
}

/**
 * Keeps the log from growing without limit, giving up the least useful first.
 *
 * A verdict you gave deliberately outlives one the row inferred: expired
 * snoozes mean nothing at all any more, an old "seen it" has usually become a
 * note in the vault, and a like or a dislike is the thing this file exists for.
 */
export function pruneFeedback(
	log: Readonly<FeedbackLog>,
	now: Date = new Date(),
	max = 400,
): FeedbackLog {
	const kept: [string, FeedbackRecord][] = [];
	for (const [key, record] of Object.entries(log)) {
		if (record.until !== undefined && record.until <= now.getTime()) continue;
		if (record.verdict === "seen" && now.getTime() - record.at > 730 * DAY) {
			continue;
		}
		kept.push([key, record]);
	}
	if (kept.length <= max) return Object.fromEntries(kept);

	// Oldest first, but never a like or a dislike while a softer record remains.
	const rank = (record: FeedbackRecord) =>
		record.verdict === "liked" || record.verdict === "disliked" ? 1 : 0;
	kept.sort((a, b) => rank(b[1]) - rank(a[1]) || b[1].at - a[1].at);
	return Object.fromEntries(kept.slice(0, max));
}

/**
 * Things you liked the look of that never became notes.
 *
 * A thumbs-up used to produce no new candidates at all: it nudged a dozen
 * trait averages by a fraction and was otherwise inert, so the most direct
 * thing anybody can say to a recommender did the least of anything they could
 * do. These are questions to ask the source, like any title on the shelf.
 */
export function likedSeeds(
	log: Readonly<FeedbackLog>,
	owned: (ref: MediaRef) => boolean = () => false,
	now: Date = new Date(),
): { ref: MediaRef; title: string }[] {
	const out: { ref: MediaRef; title: string }[] = [];
	for (const record of Object.values(log)) {
		if (activeVerdict(record, now) !== "liked" || !record.ref) continue;
		if (owned(record.ref)) continue;
		out.push({ ref: record.ref, title: record.title });
	}
	// Most recently liked first: the newest yes is the best question to ask.
	return out.sort(
		(a, b) => (log[sourceKey(b.ref)]?.at ?? 0) - (log[sourceKey(a.ref)]?.at ?? 0),
	);
}

/** Forgets rows shown long enough ago that showing them again is no repeat. */
export function pruneShown(
	log: Readonly<ShownLog>,
	now: Date = new Date(),
	keepDays = 21,
	max = SHOWN_MAX,
): ShownLog {
	const cutoff = now.getTime() - keepDays * DAY;
	const kept = Object.entries(log).filter(([, at]) => at > cutoff);
	if (kept.length <= max) return Object.fromEntries(kept);
	kept.sort((a, b) => b[1] - a[1]);
	return Object.fromEntries(kept.slice(0, max));
}
