import { normalizeTitle } from "../title";
import type { MediaItem, MediaKind } from "../types";
import { ratingFraction, statusTone, type LibraryConfig } from "./config";
import { rankReasons, type Reason } from "./reasons";
import type { TraitKey } from "./traits";
import type { LibraryEntry } from "./entry";
import {
	activeVerdict,
	feedbackKey,
	type FeedbackLog,
	type FeedbackVerdict,
	type ShownLog,
} from "./feedback";
import { neighbourBoost, type Anchor } from "./neighbours";
import {
	candidateOfItem,
	entrySignal,
	rankDiverse,
	scoreCandidate,
	type KindStat,
	type TasteProfile,
} from "./taste";
import { parseTrait } from "./traits";

/**
 * Turning a heap of candidates into a row of eight.
 *
 * The fetching lives in the view; everything that decides *what* to fetch and
 * what to do with the answers lives here, where it can be reasoned about and
 * tested without a network.
 *
 * Two questions get asked, and asking only the first was the old row's real
 * problem. "What else is like the things you liked most" can only ever return
 * neighbours of what you already own — ask it repeatedly and it walks in
 * ever-decreasing circles around a handful of favourites, which is why the row
 * felt like it knew one thing about you. "What does this catalogue have a lot
 * of people liking, in the genres you go for" reaches the whole source,
 * including the parts nothing on your shelf happens to border. The first is
 * precise and narrow, the second broad and vague, and a good row is made of
 * both.
 */

/* ------------------------------------------------------------------ seeds */

/**
 * How much this entry is worth asking the source about, or null for one that
 * is not worth asking about at all.
 *
 * Not simply "your highest rated". A recommender fed only 9s and 10s has about
 * six things to work with on a normal library and returns the same neighbours
 * every time; one fed everything you finished and did not dislike has fifty,
 * and the difference is the difference between a row that changes and a row
 * that does not. What the ratings buy is *ordering*, not membership.
 */
export function seedStrength(
	config: LibraryConfig,
	entry: LibraryEntry,
	now: Date,
): number | null {
	if (!entry.ref) return null;
	const tone = statusTone(config, entry.status);
	if (tone === "dropped") return null;

	const fraction = ratingFraction(config, entry.kind, entry.rating);
	// A middling score is a considered opinion that it was middling. Asking for
	// more of it is asking for more middling things.
	if (fraction !== undefined && fraction < 0.5) return null;
	// Nothing recorded and never started: no reason to think you liked it.
	if (fraction === undefined && !entry.favorite && tone !== "done" && tone !== "active") {
		return null;
	}

	const signal = entrySignal(config, entry, now);
	const base = fraction ?? signal?.value ?? 0.6;
	const recency = signal?.weight ?? 0.5;
	// Weighted towards how much you liked it, nudged by how recently it mattered
	// — a favourite from last month is the best question to ask a source.
	return base * 0.8 + recency * 0.2 + (entry.favorite ? 0.12 : 0);
}

/**
 * Seeds for the "what else is like this" half, best first.
 *
 * Spread across genres for the same reason the results are: three seeds from
 * one trilogy return one trilogy's worth of suggestions.
 */
export function recommendationSeeds(
	config: LibraryConfig,
	entries: readonly LibraryEntry[],
	limit = 15,
	now: Date = new Date(),
): { entry: LibraryEntry; strength: number }[] {
	const scored: { entry: LibraryEntry; strength: number }[] = [];
	for (const entry of entries) {
		const strength = seedStrength(config, entry, now);
		if (strength !== null) scored.push({ entry, strength });
	}
	return rankDiverse(
		scored,
		(at) => ({
			score: at.strength,
			tags: at.entry.tags,
			// Spread across the shelf as well as across its subjects. On a library
			// that is mostly film, seeds ranked on genre alone are all films, and a
			// row asked only about films can only ever answer about films.
			family: at.entry.kind,
		}),
		limit,
		0.3,
	);
}

/* --------------------------------------------------------------- discovery */

export interface DiscoverPlan {
	kind: MediaKind;
	genres: string[];
	without: string[];
	minRating: number;
	page: number;
}

/**
 * Genres the model has an opinion about, strongest first.
 *
 * Affinity is a comparison against your own average, which means a library
 * with only one genre in it has no genre that stands out — everything you own
 * being science fiction makes science fiction your baseline rather than your
 * preference, and the arithmetic correctly reports zero. That is the right
 * answer to "what do you like more than usual" and the wrong answer to "what
 * should we go and look for", so when nothing stands out this falls back to
 * what you simply keep most of. Weaker evidence, but it is the evidence there
 * is, and asking a catalogue for nothing in particular is worse.
 */
export function tasteGenres(
	profile: TasteProfile,
	direction: "liked" | "disliked",
	limit = 4,
): string[] {
	// Lower-cased values rather than labels, because both catalogues match their
	// genre vocabularies case-insensitively and always have.
	const all = [...profile.traits.entries()].flatMap(([key, at]) => {
		const parsed = parseTrait(key);
		return parsed?.ns === "genre" ? [[parsed.value, at] as const] : [];
	});

	if (direction === "disliked") {
		return all
			.filter(([, at]) => at.score < -0.05)
			.sort((a, b) => a[1].score - b[1].score)
			.slice(0, limit)
			.map(([name]) => name);
	}

	const liked = all
		.filter(([, at]) => at.score > 0.015)
		.sort((a, b) => b[1].score - a[1].score)
		.map(([name]) => name);
	if (liked.length >= 2) return liked.slice(0, limit);

	const common = all
		// Anything actively rated below your average stays out: keeping a lot of
		// something you keep not enjoying is not a reason to be sent more of it.
		.filter(([name, at]) => at.score > -0.02 && !liked.includes(name))
		.sort((a, b) => b[1].count - a[1].count)
		.map(([name]) => name);

	return [...liked, ...common].slice(0, limit);
}

/**
 * What to ask each catalogue for.
 *
 * One plan per kind you actually keep, because a library of films and manga is
 * two catalogues and asking either about the other returns nothing. Kinds are
 * taken in order of how much of the library they are.
 *
 * The cap used to be two, on the reasoning that a row of eight split three ways
 * is a sampler rather than a recommendation. That reasoning was about the *row*,
 * and putting it here instead meant the two kinds you keep most of won every
 * round and the rest of the library was never asked about at all. How many kinds
 * reach the row is `fillSlots`' business; this end's job is to have something of
 * each to choose from.
 */
export const DISCOVER_KINDS = 4;

/**
 * How much of the library a kind counts for when deciding what to go looking for.
 *
 * What you engage with, not what you own — a backlog is not a preference, and
 * forty unread books say you mean to read books rather than that finding a
 * forty-first would help. `at.engaged || at.owned` was meant to say that and said
 * the opposite: read per kind, a shelf of forty unopened books outranked three
 * films you actually watched, so the one case the comment warned about was the
 * one the code produced. Falling back to what is owned is right only when
 * *nothing anywhere* has been engaged with, which is a library nobody has
 * started rather than a corner of one nobody has got to.
 */
export function kindWeight(profile: TasteProfile): (at: KindStat) => number {
	for (const at of profile.kinds.values()) {
		if (at.engaged > 0) return (one) => one.engaged;
	}
	return (one) => one.owned;
}

export function discoverPlans(
	profile: TasteProfile,
	round: number,
	kinds: readonly MediaKind[],
): DiscoverPlan[] {
	const weight = kindWeight(profile);
	const share = [...profile.kinds.entries()]
		.filter(([kind, at]) => kinds.includes(kind) && weight(at) > 0)
		.sort((a, b) => weight(b[1]) - weight(a[1]))
		.slice(0, DISCOVER_KINDS)
		.map(([kind]) => kind);
	// A library with nothing in a discoverable kind still gets asked about the
	// kinds the sources can answer for, rather than nothing at all.
	const targets = share.length > 0 ? share : kinds.slice(0, 1);

	const liked = tasteGenres(profile, "liked");
	const avoid = tasteGenres(profile, "disliked", 2);

	return targets.map((kind) => ({
		kind,
		genres: liked,
		without: avoid,
		// Loosened when the model has little to go on: a strict floor plus a
		// genre it guessed at can return an empty list, and an empty row teaches
		// nobody anything.
		minRating: profile.sampled >= 4 ? 6.8 : 6.4,
		page: round + 1,
	}));
}

/* ---------------------------------------------------------------- origins */

/**
 * How a suggestion was arrived at.
 *
 * Declared here rather than in `strategies.ts` because a pooled suggestion
 * remembers it long after the request that produced it is forgotten, and
 * because the planner imports this file for `discoverPlans`.
 */
export type StrategyId =
	| "exploit"
	| "franchise"
	| "person"
	| "keyword"
	| "explore"
	| "wildcard";

export interface Origin {
	strategy: StrategyId;
	/** The title of yours this came from, when it came from one. */
	seed?: string;
	/** How much you liked that title, 0–1. */
	strength?: number;
	/** The trait that made this worth asking about, for the strategies that ask. */
	trait?: TraitKey;
	/** That trait as a person would say it. */
	label?: string;
}

/* ----------------------------------------------------------------- merging */

export interface RawSuggestion {
	item: MediaItem;
	/** Titles of yours that led here. More than one is a much stronger signal. */
	seeds: string[];
	/** The best of those seeds, 0–1, so a 10/10's neighbours outrank a 7's. */
	seedStrength: number;
	/** True when the catalogue offered it rather than one of your titles. */
	explored: boolean;
	/** How it was found — which slot in the row it is eligible for. */
	strategy: StrategyId;
	/** Whatever the strategy wanted said about it, when it had something. */
	origins: Origin[];
}

export interface SuggestionPool {
	by: Map<string, RawSuggestion>;
	/**
	 * Title-and-year to the key already holding it.
	 *
	 * The same anime comes back from TMDB and from AniList under two ids, and
	 * two of the seven places went to one show. The keys themselves cannot be
	 * changed to fix this — `providerId:id` is also the feedback key, and
	 * rewriting it would orphan every verdict already recorded — so the pool
	 * carries a second index and folds collisions into whichever arrived first.
	 */
	byIdentity: Map<string, string>;
}

export function emptyPool(): SuggestionPool {
	return { by: new Map(), byIdentity: new Map() };
}

export function suggestionKey(item: MediaItem): string {
	return feedbackKey(item.ref);
}

/** Anime is television and manga is a book, as far as being a duplicate goes. */
function kindFamily(kind: MediaKind): string {
	if (kind === "anime") return "tv";
	if (kind === "manga") return "book";
	return kind;
}

/** What makes two records from different catalogues the same work. */
export function identityKey(item: MediaItem): string {
	return `${kindFamily(item.ref.kind)}|${normalizeTitle(item.title)}|${
		item.year ?? "?"
	}`;
}

/**
 * Folds a batch of answers into the pool.
 *
 * The important line is the one that does *not* skip a title already there.
 * Three of your favourites independently pointing at the same film is the
 * single strongest thing a source ever tells you, and the previous version
 * threw it away as a duplicate — it kept the first mention and dropped every
 * corroboration. Now each repeat is recorded, and the count is worth more to
 * the ranking than any one source score.
 */
export function mergeSuggestions(
	pool: SuggestionPool,
	items: readonly MediaItem[],
	origin: Origin,
): void {
	for (const item of items) {
		const key = suggestionKey(item);
		const identity = identityKey(item);
		// A record already here under this exact id, or the same work already
		// here under another catalogue's id.
		const at = pool.by.get(key) ?? pool.by.get(pool.byIdentity.get(identity) ?? "");

		if (!at) {
			pool.by.set(key, {
				item,
				seeds: origin.seed ? [origin.seed] : [],
				seedStrength: origin.strength ?? 0,
				explored: origin.seed === undefined,
				strategy: origin.strategy,
				origins: [origin],
			});
			pool.byIdentity.set(identity, key);
			continue;
		}

		if (origin.seed && !at.seeds.includes(origin.seed)) at.seeds.push(origin.seed);
		at.seedStrength = Math.max(at.seedStrength, origin.strength ?? 0);
		// Something both a neighbour and a catalogue pick is no longer a shot in
		// the dark, so it stops being counted as one.
		if (origin.seed) at.explored = false;
		if (!at.origins.some((one) => one.strategy === origin.strategy)) {
			at.origins.push(origin);
		}
		// The narrower strategy wins the slot. A film that a catalogue also
		// happened to return is still the film that completes your series.
		if (STRATEGY_RANK[origin.strategy] < STRATEGY_RANK[at.strategy]) {
			at.strategy = origin.strategy;
		}
		// Prefer whichever record carries more, since list endpoints differ in
		// what they return and the fuller one makes a better card.
		if (item.tags.length > at.item.tags.length) at.item = item;
	}
}

/** Lower is more specific — used to decide which strategy owns a suggestion. */
const STRATEGY_RANK: Record<StrategyId, number> = {
	franchise: 0,
	exploit: 1,
	person: 2,
	keyword: 3,
	explore: 4,
	wildcard: 5,
};

/* ----------------------------------------------------------------- ranking */

export interface Suggestion {
	item: MediaItem;
	score: number;
	/** The profile's own part of that score — see `Verdict.fit`. */
	fit: number;
	/** Why, strongest first — see `rankReasons`. */
	reasons: Reason[];
	seeds: string[];
	strategy: StrategyId;
	/** Set when you have already told the model what you think of this one. */
	verdict?: FeedbackVerdict;
}

/** Weight on each extra title of yours that pointed at the same suggestion. */
const AGREEMENT = 0.4;

/** Weight on how much you liked the title it came from. */
const SEED_WEIGHT = 0.5;

/**
 * What a catalogue pick gives up against a neighbour of something you loved.
 *
 * Not zero and not large. Discovery is the half of the row that can surprise
 * you, and a penalty big enough to keep it out entirely would leave the same
 * closed circle the row had before.
 */
const EXPLORE_COST = 0.12;

export function scoreSuggestion(
	profile: TasteProfile,
	raw: RawSuggestion,
	now: Date = new Date(),
	anchors: readonly Anchor[] = [],
): { score: number; fit: number; reasons: Reason[] } {
	const candidate = candidateOfItem(raw.item);
	const verdict = scoreCandidate(profile, candidate, now);
	const near = neighbourBoost(
		anchors,
		(candidate.traits ?? []).map((one) => one.key),
		now,
	);

	// Diminishing: the second title agreeing is a revelation, the fifth is
	// confirmation of something already known.
	const agreement = AGREEMENT * Math.log2(1 + Math.max(0, raw.seeds.length - 1));

	const score =
		verdict.score +
		agreement +
		near.boost +
		SEED_WEIGHT * raw.seedStrength -
		(raw.explored ? EXPLORE_COST : 0);

	const reasons = [...verdict.reasons];
	if (near.reason) reasons.push(near.reason);
	if (raw.seeds.length > 1) {
		reasons.push({
			kind: "agreement",
			label: `${raw.seeds.length} things you liked point here`,
			short: `${raw.seeds.length} of yours agree`,
			strength: Math.min(1, raw.seeds.length / 4),
		});
	} else if (raw.seeds[0]) {
		reasons.push({
			kind: "seed",
			label: `Because you liked ${raw.seeds[0]}`,
			// The title alone in the short form. "Like " spent five of a card's
			// twenty-two characters saying what the heart icon beside it already
			// says, and it was five characters off the end of the title.
			short: raw.seeds[0],
			strength: raw.seedStrength,
		});
	}
	for (const origin of raw.origins) {
		if (origin.strategy === "wildcard") {
			// Said out loud on purpose. An unexplained off-profile pick reads as
			// the model being wrong; a labelled one reads as it being generous.
			// "A punt" was the wrong word for that: it says the model is
			// gambling, where the point is that it is deliberately looking
			// somewhere it does not usually look.
			reasons.push({
				kind: "wildcard",
				label: origin.label
					? `Branching out — you have little ${origin.label.toLowerCase()}`
					: "Branching out — outside your usual",
				short: "Branching out",
				strength: 0.4,
			});
		} else if (origin.label && origin.trait) {
			reasons.push({
				kind: origin.strategy === "franchise" ? "series" : "keyword",
				label: origin.label,
				strength: 0.6,
				ref: { trait: origin.trait },
			});
		}
	}
	// A card shows what is *for* something, so a candidate whose only recognised
	// traits are marks against it left the line under its title empty — and an
	// empty foot collapses, so one unexplained card made a row of seven ragged by
	// eighteen pixels. Tested for a reason in favour rather than for any reason at
	// all: "there is nothing good to say about this" is not the same fact as
	// "there is nothing to say".
	if (!reasons.some((one) => !one.against)) {
		reasons.push({
			kind: "explore",
			label: "Well liked, and in your line",
			short: "In your line",
			strength: 0.2,
		});
	}

	return { score, fit: verdict.fit, reasons };
}

export interface RankOptions {
	limit: number;
	/** Already on a shelf — `true` for anything the library matches. */
	owned: (item: MediaItem) => boolean;
	feedback: Readonly<FeedbackLog>;
	/** Keys stood aside from this session, so "show me others" really does. */
	skipped?: ReadonlySet<string>;
	/** When each was last put in front of you — see `COOLDOWN_DAYS`. */
	shown?: Readonly<ShownLog>;
	/** Things you have said yes to, for the "because you liked X" boost. */
	anchors?: readonly Anchor[];
	now?: Date;
}

/**
 * How long something the row has already drawn is held out of it.
 *
 * A penalty on its own was not enough, and it is worth being clear about why.
 * Half a point is about what a strong genre affinity is worth — plenty to move
 * a middling suggestion down the row, and nothing at all to the one candidate
 * that keeps winning. The suggestion best placed to shrug off the charge is by
 * definition the one that was on screen yesterday, so the titles that came back
 * were precisely the titles you were most tired of, and the row read as though
 * it had four ideas.
 *
 * So being drawn recently is a *tier* rather than a discount: while there is
 * anything in the pool you have not been shown, nothing you have been shown is
 * considered at all. Past the window the decaying penalty below is all that is
 * left, so a good suggestion that has waited its turn is delayed rather than
 * lost.
 *
 * Four days, not four weeks. Long enough that a row opened twice a day is
 * different every time, short enough that a small pool is not permanently
 * holding most of itself back.
 */
export const COOLDOWN_DAYS = 4;

/**
 * And what it costs after that.
 *
 * Also what orders the tier from within: everything held back pays this, so when
 * the row has no choice but to come round, the thing you saw longest ago is the
 * thing that comes back first.
 */
const SHOWN_PENALTY = 0.5;
const SHOWN_HALF_LIFE_DAYS = 5;

/**
 * How many of the row something you have already thumbed up may take.
 *
 * A like is not a dismissal — you said you liked the look of it, not that you
 * had dealt with it — so it stays eligible until you add it or change your mind.
 * But a row that is mostly things you have already said yes to has stopped being
 * a recommendation and become a reading list, and the reason to open it is the
 * part you have *not* seen.
 */
export const LIKED_SEATS = 2;

/** What already having said yes costs against something you have not seen. */
const LIKED_COST = 0.35;

/**
 * The pool, filtered, scored and spread out.
 *
 * Disliked titles leave for good — a thumbs-down that a row ignores is a
 * button that does nothing. So do the ones you have already seen, which is a
 * different fact and used to have to be told as a dislike. A snooze holds
 * until its date and then quietly stops applying.
 *
 * Liked ones stay, capped and discounted: see `LIKED_SEATS`. Ones the row has
 * drawn in the last few days stay too, and are only reached for once there is
 * nothing else: see `COOLDOWN_DAYS`.
 */
export function rankSuggestions(
	pool: SuggestionPool,
	profile: TasteProfile,
	options: RankOptions,
): Suggestion[] {
	const now = options.now ?? new Date();
	const scored: Suggestion[] = [];

	for (const [key, raw] of pool.by) {
		if (options.skipped?.has(key)) continue;
		if (options.owned(raw.item)) continue;

		// A dislike is permanent, "seen it" means it is dealt with, and a snooze
		// holds until its date and then stops mattering on its own.
		const verdict = activeVerdict(options.feedback[key], now);
		if (verdict && verdict !== "liked") continue;

		const { score, fit, reasons } = scoreSuggestion(
			profile,
			raw,
			now,
			options.anchors,
		);
		scored.push({
			item: raw.item,
			fit,
			score:
				score -
				shownPenalty(options.shown?.[key], now) -
				(verdict === "liked" ? LIKED_COST : 0),
			reasons: rankReasons(reasons, 4),
			seeds: raw.seeds,
			strategy: raw.strategy,
			...(verdict ? { verdict } : {}),
		});
	}

	return fillSlots(
		worthShowing(scored).map((at) => ({
			...at,
			tags: at.item.tags,
			// The kind itself rather than `kindFamily`: folding anime into
			// television is right for spotting a duplicate and wrong here, where
			// the whole point is that the row should not be seven of one thing.
			family: at.item.ref.kind,
			held: heldBack(options.shown?.[suggestionKey(at.item)], now),
		})),
		options.limit,
		{
			held: (one) => one.held,
			quota: {
				of: (one) => (one.verdict === "liked" ? "liked" : undefined),
				max: LIKED_SEATS,
			},
		},
	);
}

/**
 * What the model thinks you will actively dislike, dropped rather than seated.
 *
 * `fillSlots` fills every seat it is given from whatever it is handed, so a thin
 * pool put its worst three answers on screen beside its best four and the row
 * was judged on all seven. Six good suggestions is a better row than seven, and
 * a short row is a legible thing for a recommender to do — it says the sources
 * had little to offer today rather than pretending otherwise.
 *
 * Measured on `fit` rather than on the total, and that is the whole of why it
 * works. A neighbour of a favourite carries `SEED_WEIGHT * strength` before
 * anything else is counted, which is comfortably more than a genre you have
 * turned down three times is worth against it — so on the total, "people who
 * liked Arrival also liked this musical" outscored the floor every time, which
 * is exactly the recommendation the floor exists to stop.
 *
 * A floor rather than a proportion, and a low one: this is meant to catch what
 * you have demonstrably avoided, not to trim the merely unremarkable. The punt
 * is exempt, because being outside the profile is the entire premise of the punt
 * and its card says so.
 */
const FIT_FLOOR = -0.05;
const KEEP_AT_LEAST = 3;

function worthShowing(scored: readonly Suggestion[]): Suggestion[] {
	const kept = scored.filter(
		(at) => at.fit > FIT_FLOOR || at.strategy === "wildcard",
	);
	if (kept.length >= KEEP_AT_LEAST || kept.length === scored.length) return kept;
	// Too little got through to make a row of it, so the floor stands down: an
	// empty row teaches nobody anything, which is the same reason `discoverPlans`
	// loosens its rating filter on a library it knows little about.
	return [...scored].sort((a, b) => b.score - a.score).slice(0, KEEP_AT_LEAST);
}

/**
 * Who gets a guaranteed seat in the row of seven.
 *
 * A budget rather than one flat ranking, and this is the part that makes the
 * row feel different. Ranking everything together sounds fairer and is not: a
 * sequel shares its predecessor's genres, so the diversity pass docks it and a
 * franchise pick essentially never wins a seat — the suggestion a person would
 * find most obviously right is the one a single ordering reliably excludes.
 * The same goes for the punt, which is off-profile by construction and so
 * always ranks last.
 *
 * Order matters: earlier slots choose first.
 */
export const SLOTS: readonly { strategy: StrategyId; count: number }[] = [
	{ strategy: "exploit", count: 2 },
	{ strategy: "franchise", count: 1 },
	{ strategy: "person", count: 1 },
	{ strategy: "keyword", count: 1 },
	{ strategy: "explore", count: 1 },
	{ strategy: "wildcard", count: 1 },
];

/** What a repeated subject, a repeated kind, and a spent quota cost a pick. */
export interface FillOptions<T> {
	slots?: readonly { strategy: StrategyId; count: number }[];
	/** Charged per subject the pick shares with something already placed. */
	penalty?: number;
	/**
	 * Charged per thing of the same *kind* already placed.
	 *
	 * Gentler than the subject penalty and doing a different job. Without it a
	 * library that is four-fifths film gets a row that is entirely film, however
	 * many books and shows came back — the row's own answer to "what about the
	 * other types" was that they were always the eighth-best thing on it.
	 *
	 * Gentle on purpose: it must be enough to seat a near-miss of another kind
	 * and not enough to seat a bad one. When the pool is all of one kind it
	 * charges everything equally and so changes nothing at all.
	 */
	kindPenalty?: number;
	/**
	 * Shown to you recently — see `COOLDOWN_DAYS`.
	 *
	 * Not a penalty and not a filter. Held-back picks are simply not considered
	 * while anything else can fill the seat, including a budgeted seat: a slot
	 * whose only candidates have all been seen donates it rather than spending it
	 * on a repeat, which is the difference between a row that has moved on and a
	 * row that has moved five of seven places on.
	 *
	 * When *nothing* in the pool is fresh the hold lifts entirely, budget and
	 * all. Holding things back to keep the row moving is pointless once there is
	 * nowhere for it to move to, and a well-ordered repeat beats an empty row.
	 */
	held?: (one: T) => boolean;
	/** A group that may only have so many seats — see `LIKED_SEATS`. */
	quota?: { of: (one: T) => string | undefined; max: number };
}

/**
 * Fills the row against the budget, then fills what is left by plain merit.
 *
 * A slot nobody can fill — no series has a gap, nothing has been read up on
 * yet — donates its seat rather than leaving a hole, so the row is always as
 * full as the pool allows. Every pick, budgeted or not, still pays the
 * diversity penalty against what is already placed, so guaranteeing the
 * franchise strategy a seat does not mean guaranteeing three films of one
 * series.
 */
export function fillSlots<
	T extends {
		score: number;
		strategy: StrategyId;
		tags: readonly string[];
		/** Which kind of thing this is, when the caller cares that they differ. */
		family?: string;
	},
>(scored: readonly T[], limit: number, options: FillOptions<T> = {}): T[] {
	const slots = options.slots ?? SLOTS;
	const penalty = options.penalty ?? 0.55;
	const kindPenalty = options.kindPenalty ?? 0.3;
	const quota = options.quota;
	const holding = options.held;
	// Whether holding anything back can achieve anything — see `FillOptions.held`.
	const anyFresh = holding ? scored.some((one) => !holding(one)) : false;
	const stale = (one: T): boolean =>
		anyFresh && holding !== undefined && holding(one);

	const pool = [...scored];
	const out: T[] = [];
	const used = new Map<string, number>();
	const families = new Map<string, number>();
	const spent = new Map<string, number>();

	const take = (only: StrategyId | undefined, repeats: boolean): boolean => {
		let bestAt = -1;
		let best = -Infinity;
		for (let at = 0; at < pool.length; at++) {
			const one = pool[at];
			if (!one || (only && one.strategy !== only)) continue;
			if (!repeats && stale(one)) continue;
			if (quota) {
				const group = quota.of(one);
				if (group && (spent.get(group) ?? 0) >= quota.max) continue;
			}
			const seen = one.tags.reduce(
				(most, tag) => Math.max(most, used.get(tag.trim().toLowerCase()) ?? 0),
				0,
			);
			const alike = one.family ? (families.get(one.family) ?? 0) : 0;
			const adjusted = one.score - seen * penalty - alike * kindPenalty;
			if (adjusted > best) {
				best = adjusted;
				bestAt = at;
			}
		}
		if (bestAt < 0) return false;
		const [picked] = pool.splice(bestAt, 1);
		if (!picked) return false;
		out.push(picked);
		for (const tag of picked.tags) {
			const key = tag.trim().toLowerCase();
			used.set(key, (used.get(key) ?? 0) + 1);
		}
		if (picked.family) {
			families.set(picked.family, (families.get(picked.family) ?? 0) + 1);
		}
		const group = quota?.of(picked);
		if (group) spent.set(group, (spent.get(group) ?? 0) + 1);
		return true;
	};

	for (const slot of slots) {
		for (let n = 0; n < slot.count && out.length < limit; n++) {
			take(slot.strategy, false);
		}
	}
	// The donated seats, and any spare. Anything held back is offered the seat
	// only once nothing fresh will take it.
	while (
		out.length < limit &&
		(take(undefined, false) || take(undefined, true))
	) {
		/* keeps going until the pool or the limit runs out */
	}
	return out;
}

function daysSince(at: number, now: Date): number {
	return Math.max(0, (now.getTime() - at) / (24 * 60 * 60 * 1000));
}

/** Drawn recently enough that drawing it again would be a repeat. */
function heldBack(at: number | undefined, now: Date): boolean {
	return at !== undefined && daysSince(at, now) < COOLDOWN_DAYS;
}

function shownPenalty(at: number | undefined, now: Date): number {
	if (at === undefined) return 0;
	return SHOWN_PENALTY * 0.5 ** (daysSince(at, now) / SHOWN_HALF_LIFE_DAYS);
}
