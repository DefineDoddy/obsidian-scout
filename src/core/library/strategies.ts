import type { DiscoverQuery, TermRef } from "../provider";
import { sourceKey, type MediaKind, type MediaRef } from "../types";
import type { EnrichmentCache } from "./enrich";
import type { LibraryEntry } from "./entry";
import {
	discoverPlans,
	kindWeight,
	type Origin,
	type StrategyId,
} from "./recommend";
import { topTraits, type TasteProfile } from "./taste";

/**
 * Deciding what to ask, without being able to ask it.
 *
 * This used to be twenty lines in the middle of a React component, tangled up
 * with the `AbortController` and the loading flag, and therefore untestable —
 * vitest only collects `.ts`, so the entire question of *what the recommender
 * asks the world* had no coverage at all. Pulled out here it is a pure
 * function from a taste profile to a list of requests, and the awkward
 * questions ("does it ask a source that is switched off?", "does it walk
 * further down the catalogue on the second press?") become one-line tests.
 *
 * Nothing here knows what a provider is. `RegistryFacts` is three methods
 * returning ids, so a test hands it an object literal.
 */

/** How many of your own titles get asked about per round. */
export const SEEDS_PER_ROUND = 4;

/** How far down each catalogue the row will page before it gives up. */
export const EXPLORE_ROUNDS = 4;

export interface Request {
	/** Dedupes within a round and across rounds. */
	id: string;
	op: "similar" | "discover" | "series";
	providerId: string;
	ref?: MediaRef;
	query?: DiscoverQuery;
	origin: Origin;
}

/** What the registry can answer, reduced to the part planning needs. */
export interface RegistryFacts {
	recommendable(kind: MediaKind): string[];
	discoverable(kind: MediaKind): string[];
	seriesAware(kind: MediaKind): string[];
}

export interface Seed {
	entry: LibraryEntry;
	strength: number;
}

export interface PlanInput {
	profile: TasteProfile;
	seeds: readonly Seed[];
	/** Kinds some configured source can be asked to browse. */
	kinds: readonly MediaKind[];
	facts: RegistryFacts;
	/**
	 * Things you thumbed up that are not in the library.
	 *
	 * A thumbs-up used to produce no new candidates whatsoever — it nudged a
	 * dozen trait averages by a fraction and was otherwise inert, so the most
	 * direct thing anybody can tell a recommender did the least. These are
	 * seeds like any other, at a strength below a title you actually watched.
	 */
	liked?: readonly { ref: MediaRef; title: string }[];
	/** What the sources have said, for the keyword and person strategies. */
	enrichment?: Readonly<EnrichmentCache>;
}

/** How much a thing you liked the look of is worth against one you watched. */
const LIKED_STRENGTH = 0.7;

/**
 * The `round`th window of `size` items, coming round again at the end.
 *
 * Wrapping rather than running off the end is what lets "show me others" be
 * pressed indefinitely. Slicing meant the fifth press asked about seeds
 * twenty-one to twenty-four of a list of eighteen — that is, about nothing — and
 * the row simply stopped having anything to say. Coming round to the start asks
 * a question already asked, which the day-long HTTP cache answers for free, and
 * the pool it lands in has moved on: the seven things on screen have been stood
 * aside, so the same answers produce a different row.
 */
function wrap<T>(all: readonly T[], round: number, size: number): T[] {
	if (all.length === 0) return [];
	const start = (round * size) % all.length;
	return [...all, ...all].slice(start, start + Math.min(size, all.length));
}

/** A director needs this many titles before it is worth going looking. */
const DIRECTOR_EVIDENCE = 2;

/**
 * Neighbours of your own titles, and whatever the catalogue has plenty of
 * people liking in the genres you go for.
 *
 * Asking only the first was the row's original problem: neighbours-of-what-you-
 * own can only ever return more of what you own, and on a small library that is
 * a very small world. Asking only the second gives you a chart. The row wants
 * both, and later phases add four more ways in beside these two.
 */
export function planRound(input: PlanInput, round: number): Request[] {
	const { profile, seeds, kinds, facts } = input;
	const out: Request[] = [];
	const seen = new Set<string>();

	const push = (request: Request) => {
		if (seen.has(request.id)) return;
		seen.add(request.id);
		out.push(request);
	};

	for (const seed of wrap(seeds, round, SEEDS_PER_ROUND)) {
		const ref = seed.entry.ref;
		if (!ref) continue;
		// A source that is unconfigured, switched off, or simply cannot answer
		// "what else is like this" is not asked. The old code checked the
		// capability but not whether the user had turned the source off.
		if (!facts.recommendable(ref.kind).includes(ref.providerId)) continue;
		push({
			id: `similar:${ref.providerId}:${ref.id}`,
			op: "similar",
			providerId: ref.providerId,
			ref,
			origin: {
				strategy: "exploit",
				seed: seed.entry.title,
				strength: seed.strength,
			},
		});
	}

	// Things you liked the look of but never added. Asked about after your own
	// titles, so they extend the round rather than crowding it out.
	for (const one of wrap(input.liked ?? [], round, 2)) {
		if (!facts.recommendable(one.ref.kind).includes(one.ref.providerId)) continue;
		push({
			id: `similar:${one.ref.providerId}:${one.ref.id}`,
			op: "similar",
			providerId: one.ref.providerId,
			ref: one.ref,
			origin: {
				strategy: "exploit",
				seed: one.title,
				strength: LIKED_STRENGTH,
			},
		});
	}

	for (const request of franchisePlans(input, round)) push(request);
	for (const request of keywordPlans(input, round)) push(request);
	for (const request of personPlans(input, round)) push(request);

	for (const plan of discoverPlans(profile, round, kinds)) {
		for (const providerId of facts.discoverable(plan.kind)) {
			push({
				id: `discover:${providerId}:${plan.kind}:${plan.page}`,
				op: "discover",
				providerId,
				query: plan,
				origin: { strategy: "explore" },
			});
		}
	}

	for (const request of wildcardPlans(input, round)) push(request);

	return out;
}

/**
 * "You have three of the five Alien films."
 *
 * The highest-value new source and very nearly the cheapest: the series call
 * is already cached for a day, and most of what it needs was harvested during
 * enrichment. It is also the pick a person is most likely to look at and think
 * *yes, obviously* — which is exactly the pick a single flat ranking always
 * threw away, because a sequel shares its predecessor's genres and the
 * diversity pass docked it for that.
 *
 * Ordered by how much of a series you already have. Four of five is somebody
 * finishing something; one of six is somebody who watched a film once.
 */
function franchisePlans(input: PlanInput, round: number): Request[] {
	const held = new Map<string, { ref: MediaRef; have: number; title: string }>();

	for (const seed of input.seeds) {
		const ref = seed.entry.ref;
		if (!ref) continue;
		if (!input.facts.seriesAware(ref.kind).includes(ref.providerId)) continue;
		const record = input.enrichment?.[sourceKey(ref)];
		const series = record?.series;
		if (!series) continue;

		const at = held.get(series.id);
		if (at) at.have += 1;
		else held.set(series.id, { ref, have: 1, title: series.name });
	}

	const ordered = [...held.values()].sort((a, b) => b.have - a.have);
	// One per round: each is a request, and a library of long-running series
	// would otherwise spend the whole budget here.
	const pick = ordered[round % Math.max(1, ordered.length)];
	if (!pick) return [];

	return [
		{
			id: `series:${pick.ref.providerId}:${pick.ref.id}`,
			op: "series",
			providerId: pick.ref.providerId,
			ref: pick.ref,
			origin: {
				strategy: "franchise",
				label: `More of ${pick.title}`,
				seed: pick.title,
				strength: 0.85,
			},
		},
	];
}

/**
 * The kinds worth asking about, most engaged with first.
 *
 * Capped at two, once, and that cap was why the row was films and television and
 * nothing else. A library of films, shows, books and manga has four kinds in it;
 * the two the user keeps most of won that argument every round, so the books on
 * the shelf were never once asked about and the row's answer to "what about the
 * other types" was that it had never heard of them.
 *
 * Every kind the profile has *engaged* with gets asked about now, which is not
 * the same as every kind on the shelf — see `KindStat`. A backlog of forty
 * unread books is not a reason to go and find a forty-first.
 */
export const KINDS_PER_ROUND = 4;

function targetKinds(input: PlanInput): MediaKind[] {
	const weight = kindWeight(input.profile);
	const share = [...input.profile.kinds.entries()]
		.filter(([kind, at]) => input.kinds.includes(kind) && weight(at) > 0)
		.sort((a, b) => weight(b[1]) - weight(a[1]))
		.slice(0, KINDS_PER_ROUND)
		.map(([kind]) => kind);
	return share.length > 0 ? share : input.kinds.slice(0, 1);
}

/**
 * "You keep going for time loops."
 *
 * The sentence a genre model can never say, and the single biggest thing
 * enrichment buys. Silent until something has read up on the library, which is
 * correct: with no keywords in the profile there is nothing to ask about.
 */
function keywordPlans(input: PlanInput, round: number): Request[] {
	// Two titles minimum, filtered inside `topTraits` rather than after it — see
	// its note. Filtering after the slice meant this returned nothing at all on
	// any library with more than a few dozen harvested keywords, which is every
	// library the strategy was written for.
	const liked = topTraits(input.profile, "keyword", 6, "liked", 2);
	if (liked.length === 0) return [];

	// Rotated by round, so pressing "show me others" asks about the next few
	// rather than the same three again.
	const at = (round * 3) % liked.length;
	const chosen = [...liked, ...liked].slice(at, at + 3);
	const avoid = topTraits(input.profile, "keyword", 2, "disliked");
	const terms = termsFor(input, chosen.map((one) => one.label));

	const out: Request[] = [];
	for (const kind of targetKinds(input)) {
		for (const providerId of input.facts.discoverable(kind)) {
			out.push({
				id: `keyword:${providerId}:${kind}:${round}`,
				op: "discover",
				providerId,
				query: {
					kind,
					keywords: terms,
					withoutKeywords: termsFor(input, avoid.map((one) => one.label)),
					minRating: 6.4,
					page: 1 + Math.floor(round / 2),
				},
				origin: {
					strategy: "keyword",
					trait: chosen[0]?.key,
					label: chosen[0]?.label,
				},
			});
		}
	}
	return out;
}

/**
 * More from whoever you keep coming back to.
 *
 * A strong director affinity used to produce no candidates at all — the model
 * would happily tell you it had noticed, and then never act on it.
 */
function personPlans(input: PlanInput, round: number): Request[] {
	const followed = topTraits(
		input.profile,
		"director",
		4,
		"liked",
		DIRECTOR_EVIDENCE,
	);
	if (followed.length === 0) return [];

	const one = followed[round % followed.length];
	if (!one) return [];
	const [term] = termsFor(input, [one.label]);
	// Without an id there is nothing to filter on: the name can be learned from
	// but not looked up.
	if (!term?.id) return [];

	const out: Request[] = [];
	for (const kind of targetKinds(input)) {
		for (const providerId of input.facts.discoverable(kind)) {
			out.push({
				id: `person:${providerId}:${kind}:${term.id}`,
				op: "discover",
				providerId,
				query: { kind, crew: [term], sort: "rated" },
				origin: { strategy: "person", trait: one.key, label: one.label },
			});
		}
	}
	return out;
}

/**
 * One seat, always, for something outside the profile entirely.
 *
 * A row that only ever confirms what it already believes about you narrows for
 * as long as you use it. The label matters as much as the pick: an unexplained
 * off-profile suggestion reads as the model being wrong, where a labelled one
 * reads as it being generous.
 */
function wildcardPlans(input: PlanInput, round: number): Request[] {
	const known = new Set(
		topTraits(input.profile, "genre", 40).map((one) => one.label.toLowerCase()),
	);
	const stranger = WILDCARD_GENRES.filter((name) => !known.has(name.toLowerCase()));
	const pick = stranger[round % Math.max(1, stranger.length)];
	if (!pick) return [];

	const kind = targetKinds(input)[0];
	if (!kind) return [];

	const out: Request[] = [];
	for (const providerId of input.facts.discoverable(kind)) {
		out.push({
			id: `wildcard:${providerId}:${kind}:${pick}`,
			op: "discover",
			providerId,
			query: { kind, genres: [pick], minRating: 7.2, sort: "rated" },
			origin: { strategy: "wildcard", label: pick },
		});
	}
	return out;
}

/**
 * Genres broad enough that every catalogue has them and most libraries are
 * missing at least one. Not a taste judgement — a list of doors.
 */
const WILDCARD_GENRES = [
	"Documentary",
	"Animation",
	"Western",
	"Musical",
	"History",
	"Comedy",
	"Horror",
	"Romance",
];

/**
 * Trait labels turned back into terms a catalogue can be asked about.
 *
 * The profile knows names; a filter needs ids, and the only place an id exists
 * is the harvest it arrived in. A name with no id is still returned, because a
 * source that matches on names (Open Library does) can use it.
 */
function termsFor(input: PlanInput, labels: readonly string[]): TermRef[] {
	const ids = new Map<string, string>();
	for (const record of Object.values(input.enrichment ?? {})) {
		for (const one of [...record.keywords, ...record.directors, ...record.people]) {
			if (one.id && !ids.has(one.name.toLowerCase())) {
				ids.set(one.name.toLowerCase(), one.id);
			}
		}
	}
	return labels.map((name) => {
		const id = ids.get(name.toLowerCase());
		return id ? { name, id } : { name };
	});
}

/**
 * How many rounds there are to walk before the row has nothing left to ask.
 *
 * The seeds run out when they run out; the catalogues do not, so paging them is
 * capped rather than exhausted.
 */
export function roundsAvailable(
	seeds: readonly Seed[],
	kinds: readonly MediaKind[],
): number {
	return Math.max(
		Math.ceil(seeds.length / SEEDS_PER_ROUND),
		kinds.length > 0 ? EXPLORE_ROUNDS : 0,
	);
}
