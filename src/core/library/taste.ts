import type { MediaItem, MediaKind } from "../types";
import {
	ratingFraction,
	ratingScaleFor,
	statusTone,
	type LibraryConfig,
} from "./config";
import type { LibraryEntry } from "./entry";
import type { FeedbackLog } from "./feedback";
import { reasonForNamespace, type Reason } from "./reasons";
import {
	NAMESPACE_CAP,
	NAMESPACE_PRIOR,
	NAMESPACE_WEIGHT,
	parseTrait,
	traitKey,
	traitsOfEntry,
	traitsOfItem,
	traitsOfRecord,
	type Namespace,
	type Trait,
	type TraitKey,
	type TraitOptions,
} from "./traits";

/**
 * What this library says about the person keeping it.
 *
 * The whole model is one idea repeated: a genre, a person, or a kind is worth
 * something to you by how much your opinion of the things carrying it differs
 * from your opinion of everything. Loving science fiction is not rating it 8 —
 * it is rating it 8 when you rate everything else 6.
 *
 * Three things stop that idea from misbehaving on a real library:
 *
 * - **Shrinkage.** One 10 for the only western you have ever seen is not
 *   evidence that you love westerns. Every affinity is divided by its own
 *   sample size *plus a constant*, so a genre has to keep being good across
 *   several titles before it counts for much. This is the Bayesian average
 *   every ratings site ends up reinventing, and it is the difference between a
 *   recommender that works and one that hands you your one fluke.
 *
 * - **Recency.** Taste moves. A finish from last month says more about what to
 *   suggest tonight than one from six years ago, so each signal decays with
 *   age — but never to nothing, because a favourite from 2016 is still a
 *   favourite.
 *
 * - **Everything is a signal, not just scores.** Most libraries are mostly
 *   unrated. Finishing something is mild approval, favouriting it is strong
 *   approval, and dropping it is the clearest opinion anyone ever records.
 *   Reading only the star ratings would throw away most of what is there.
 *
 * On top of the library sits whatever you have said about the suggestions
 * themselves. That is the only evidence the vault cannot hold: every note is
 * about something you already chose, so a library alone can teach the model
 * what you like but never what it keeps *mistaking* for what you like.
 */

/** How many titles a genre needs before its affinity is taken at face value. */
const GENRE_PRIOR = 2.5;

/**
 * The same, for people. Lower, because two films by the same director is
 * already a pattern where two films sharing "Drama" is not.
 */
const PERSON_PRIOR = 1.2;

/** Signal half-life, in years. */
const HALF_LIFE = 2.5;

/** The floor recency decay never goes below — old favourites still count. */
const MIN_RECENCY = 0.3;

/** Assumed rating fraction for something finished but never scored. */
const FINISHED_SIGNAL = 0.62;

/** And for something given up on, which is the loudest opinion there is. */
const DROPPED_SIGNAL = 0.1;

/**
 * How far back towards neutral getting most of the way through pulls a drop.
 *
 * Giving up two episodes in and giving up two episodes from the end are both
 * "dropped", and they mean opposite things: the first is a rejection, the
 * second is nearly a finish that life got in the way of.
 */
const DROPPED_LENIENCY = 0.25;

/**
 * Assumed fraction for something you are a good way into but still watching.
 *
 * Below a finish, because you have not finished it, and above nothing — which
 * is what thirty episodes of a running series counted for before. Someone
 * halfway through a long show was contributing nothing at all to their own
 * profile, and staying with something that long is an opinion.
 */
const ACTIVE_SIGNAL = 0.55;
const ACTIVE_LENIENCY = 0.15;

/** Added to the signal of anything marked a favourite. Once. */
const FAVOURITE_BONUS = 0.18;

/**
 * What each time back through something is worth.
 *
 * Rewatching is the loudest endorsement a library holds, and it was being
 * ignored entirely. It lifts both halves of the signal on purpose: going back
 * to something says both that you liked it and that the reading is a sure one.
 */
const REPLAY_BONUS = 0.05;
const REPLAY_WEIGHT = 0.15;
const MAX_REPLAYS = 3;

/**
 * How hard the whole library's average pulls on any one kind's average.
 *
 * People rate by kind — films out of ten generously, games out of five harshly
 * — and measuring both against a single number made every trait on the harsher
 * shelf negative for reasons that had nothing to do with the shelf. Each kind
 * gets its own baseline, shrunk towards the global one so that a kind with
 * three things on it does not get to declare an average of its own.
 */
const KIND_BASELINE_PRIOR = 4;

/** Which reading of an entry a signal came from. */
export type SignalVia =
	| "rating"
	| "episodes"
	| "dropped"
	| "done"
	| "progress"
	| "favourite";

/** How sure each reading is. A score you typed is the only certain one. */
const CONFIDENCE: Record<SignalVia, number> = {
	rating: 1,
	episodes: 0.8,
	dropped: 0.75,
	favourite: 0.7,
	done: 0.6,
	progress: 0.5,
};

/**
 * A thumbs-up on a suggestion, as a rating fraction, and the weight it carries.
 *
 * Deliberately less than a real viewing. Liking the look of something is a
 * judgement of a poster and a sentence, and it should nudge the model rather
 * than steer it — the point is to correct a model built from the library, not
 * to replace it with one built from glances.
 */
const LIKED_SIGNAL = 0.88;
const DISLIKED_SIGNAL = 0.12;
const FEEDBACK_WEIGHT = 0.7;

export interface TasteProfile {
	/** Your average opinion, 0–1, against which every affinity is measured. */
	baseline: number;
	/** The same, per kind — see `KIND_BASELINE_PRIOR`. */
	baselines: Map<MediaKind, number>;
	/** Every feature the library has an opinion about, in one space. */
	traits: Map<TraitKey, Affinity>;
	/** The spelling to show for each, since the key has folded the case away. */
	labels: Map<TraitKey, string>;
	kinds: Map<MediaKind, KindStat>;
	/** How many entries carried an opinion at all. Below a handful, be humble. */
	sampled: number;
	/** How many of those came from thumbs on suggestions rather than from notes. */
	trained: number;
}

/**
 * How much of a kind is on the shelf, and how much of it you have engaged with.
 *
 * Two numbers rather than one because a backlog is not a preference. Forty
 * unread books say you mean to read books; they say nothing about whether you
 * enjoy them, and letting them steer the row towards books is how a to-read
 * pile becomes a self-fulfilling prophecy.
 */
export interface KindStat {
	owned: number;
	engaged: number;
}

export interface Affinity {
	/** Roughly −0.5…+0.5. Positive means you like it more than you like things. */
	score: number;
	/** Titles this was learned from — what the UI means by "you liked 4 of these". */
	count: number;
}

/** Lower-cased and trimmed, so "Sci-Fi" and "sci-fi " are one genre. */
const key = (value: string) => value.trim().toLowerCase();

/** Years between two dates, never negative. */
function yearsSince(iso: string | undefined, fallback: number, now: Date): number {
	const at = iso ? Date.parse(iso) : fallback;
	if (!Number.isFinite(at)) return 0;
	return Math.max(0, (now.getTime() - at) / (365.25 * 24 * 3600 * 1000));
}

/** How far through it you are, 0 when the note does not say. */
function completionOf(entry: LibraryEntry): number {
	const total = entry.progressTotal;
	if (!total || total <= 0 || entry.progress === undefined) return 0;
	return Math.min(Math.max(entry.progress / total, 0), 1);
}

/**
 * What the episode log averages out to, for someone who rates episodes.
 *
 * Two or more, because one episode rating is a note about an episode rather
 * than a verdict on the series. Somebody who marks up every episode and never
 * scores the show itself was invisible to the model before this.
 */
function episodeMean(
	config: LibraryConfig,
	entry: LibraryEntry,
): number | undefined {
	const scale = ratingScaleFor(config, entry.kind);
	if (!(scale > 0)) return undefined;
	let sum = 0;
	let seen = 0;
	for (const mark of Object.values(entry.episodeLog)) {
		if (typeof mark?.rating !== "number") continue;
		sum += mark.rating;
		seen += 1;
	}
	if (seen < 2) return undefined;
	return Math.min(Math.max(sum / seen / scale, 0), 1);
}

export interface Signal {
	value: number;
	weight: number;
	via: SignalVia;
}

/**
 * What one entry says, and how loudly.
 *
 * `null` for an entry that says nothing — something on the shelf you have not
 * started has no opinion attached to it, and counting it as neutral would drag
 * every affinity towards the baseline for no reason.
 *
 * The branches are in order of how directly they were told to you: a score you
 * typed, then episode scores you typed, then what the status and how far you
 * got imply, then the star on the note. Each one names itself so the weight
 * below can say how much it trusts it.
 */
export function entrySignal(
	config: LibraryConfig,
	entry: LibraryEntry,
	now: Date,
): Signal | null {
	const tone = statusTone(config, entry.status);
	const rated = ratingFraction(config, entry.kind, entry.rating);
	const episodes = rated === undefined ? episodeMean(config, entry) : undefined;
	const completion = completionOf(entry);

	let value: number | null = null;
	let via: SignalVia | null = null;
	if (rated !== undefined) {
		value = rated;
		via = "rating";
	} else if (episodes !== undefined) {
		value = episodes;
		via = "episodes";
	} else if (tone === "dropped") {
		value = DROPPED_SIGNAL + DROPPED_LENIENCY * completion;
		via = "dropped";
	} else if (tone === "done") {
		value = FINISHED_SIGNAL;
		via = "done";
	} else if (tone === "active" && completion >= 0.5) {
		value = ACTIVE_SIGNAL + ACTIVE_LENIENCY * completion;
		via = "progress";
	} else if (entry.favorite) {
		value = FINISHED_SIGNAL;
		via = "favourite";
	}
	if (value === null || via === null) return null;

	const replays = Math.min(entry.history.length, MAX_REPLAYS);
	value = Math.min(1, value + REPLAY_BONUS * replays);
	// Once. The branches above no longer bake it in, which they used to do for
	// an unrated favourite — and then this line added it a second time, so a
	// starred note with no score outranked a considered nine out of ten.
	if (entry.favorite) value = Math.min(1, value + FAVOURITE_BONUS);

	// Dated by when you finished it, falling back to when the note was made —
	// which for anything added and rated in one go is the same day.
	const age = yearsSince(entry.finished ?? entry.started, entry.created, now);
	const recency = Math.max(MIN_RECENCY, 0.5 ** (age / HALF_LIFE));
	const weight = recency * CONFIDENCE[via] * (1 + REPLAY_WEIGHT * replays);

	return { value, weight, via };
}

export function buildTaste(
	config: LibraryConfig,
	entries: readonly LibraryEntry[],
	now: Date = new Date(),
	feedback: Readonly<FeedbackLog> = {},
	traitOptions: TraitOptions = {},
): TasteProfile {
	const signals: { entry: LibraryEntry; value: number; weight: number }[] = [];
	let sum = 0;
	let total = 0;
	const perKind = new Map<MediaKind, { sum: number; weight: number }>();

	for (const entry of entries) {
		const signal = entrySignal(config, entry, now);
		if (!signal) continue;
		signals.push({ entry, ...signal });
		sum += signal.value * signal.weight;
		total += signal.weight;
		const at = perKind.get(entry.kind) ?? { sum: 0, weight: 0 };
		at.sum += signal.value * signal.weight;
		at.weight += signal.weight;
		perKind.set(entry.kind, at);
	}

	// With nothing to go on, "average" is the middle of the scale rather than
	// zero, or the first thing rated would look like a revelation.
	const baseline = total > 0 ? sum / total : 0.6;

	const baselines = new Map<MediaKind, number>();
	for (const [kind, at] of perKind) {
		baselines.set(
			kind,
			(at.sum + KIND_BASELINE_PRIOR * baseline) /
				(at.weight + KIND_BASELINE_PRIOR),
		);
	}
	const baselineOf = (kind: MediaKind) => baselines.get(kind) ?? baseline;

	const raw = new Map<
		TraitKey,
		{ sum: number; weight: number; count: number }
	>();
	const labels = new Map<TraitKey, string>();
	const kinds = new Map<MediaKind, KindStat>();

	const add = (trait: Trait, delta: number, weight: number) => {
		const at = raw.get(trait.key) ?? { sum: 0, weight: 0, count: 0 };
		at.sum += delta * weight;
		at.weight += weight;
		at.count += 1;
		raw.set(trait.key, at);
		if (!labels.has(trait.key)) labels.set(trait.key, trait.label);
	};

	for (const { entry, value, weight } of signals) {
		const delta = value - baselineOf(entry.kind);
		for (const trait of traitsOfEntry(entry, traitOptions)) {
			add(trait, delta, weight);
		}
	}

	/**
	 * Thumbs, folded in after the baseline is settled rather than before it.
	 *
	 * A run of thumbs-up would otherwise raise the average the whole model is
	 * measured against, and every real entry in the library would start looking
	 * like a disappointment by comparison.
	 */
	let trained = 0;
	for (const record of Object.values(feedback)) {
		trained += 1;
		const value =
			record.verdict === "liked" ? LIKED_SIGNAL : DISLIKED_SIGNAL;
		const age = Math.max(
			0,
			(now.getTime() - record.at) / (365.25 * 24 * 3600 * 1000),
		);
		const weight =
			FEEDBACK_WEIGHT * Math.max(MIN_RECENCY, 0.5 ** (age / HALF_LIFE));
		const delta = value - baselineOf(record.kind);
		for (const trait of traitsOfRecord(record)) add(trait, delta, weight);
	}

	for (const entry of entries) {
		const at = kinds.get(entry.kind) ?? { owned: 0, engaged: 0 };
		at.owned += 1;
		kinds.set(entry.kind, at);
	}
	for (const { entry } of signals) {
		const at = kinds.get(entry.kind);
		if (at) at.engaged += 1;
	}

	// Each namespace shrinks against its own prior: a director needs less
	// corroboration than a genre before the model believes the pattern.
	const traits = new Map<TraitKey, Affinity>();
	for (const [trait, at] of raw) {
		const ns = parseTrait(trait)?.ns;
		const prior = (ns && NAMESPACE_PRIOR[ns]) ?? NAMESPACE_PRIOR.genre;
		traits.set(trait, {
			score: at.sum / (at.weight + prior),
			count: at.count,
		});
	}

	return {
		baseline,
		baselines,
		traits,
		labels,
		kinds,
		sampled: signals.length,
		trained,
	};
}

/* ------------------------------------------------------------- scoring */

/** The little of a candidate that scoring needs — a note or a search result. */
export interface Candidate {
	kind: MediaKind;
	tags: readonly string[];
	people: readonly string[];
	/** The source's score out of ten, when it has one. */
	sourceRating?: number;
	/** How many people that score is an average of, when the source says. */
	ratingCount?: number;
	year?: number;
	/** Which catalogue said so — its averages are on its own terms. */
	providerId?: string;
	/** Worked out already, when whoever built this knew more than tags and names. */
	traits?: readonly Trait[];
}

/**
 * What an average title looks like at each source, and how many votes it takes
 * to be believed over that.
 *
 * One pair of numbers for everything was a TMDB assumption wearing no hat.
 * Open Library rating counts are routinely under fifty, so against a prior of
 * 250 every book shrank to almost exactly zero and could never out-rank a film
 * — books were being filtered out by arithmetic rather than by taste. AniList's
 * `ratingCount` is a member count in the tens of thousands and needs the
 * opposite correction.
 */
const QUALITY_PRIOR: Record<string, { average: number; votes: number }> = {
	tmdb: { average: 6.5, votes: 250 },
	anilist: { average: 6.8, votes: 8000 },
	openlibrary: { average: 6.8, votes: 40 },
};

const DEFAULT_QUALITY_PRIOR = { average: 6.5, votes: 250 };

/**
 * What being a complete stranger costs.
 *
 * "Unknown is not disliked" is the right rule for one trait and the wrong rule
 * for a whole candidate. Dropping every unrecognised trait means a film the
 * library has never met anything about scores `familiar = 0` — level with a film
 * whose known traits cancel out, and *ahead* of one carrying a couple of mild
 * dislikes. So the row filled up with titles the model had no opinion about
 * whatsoever and then explained them with "well liked at the source", which is
 * exactly the row that does not feel like it is learning from anything.
 *
 * Nothing here says a stranger is bad. It says a stranger has not yet given the
 * profile anything to go on, and a candidate that has should go first.
 */
const STRANGER_COST = 0.22;

/** The share of a candidate's own description that has to land to pay nothing. */
const RECOGNISED_ENOUGH = 0.4;

/**
 * Namespaces that describe a work rather than merely locate it.
 *
 * Decade, language and runtime are excluded because every candidate has them
 * and the profile has met them all, so counting them would put the floor of
 * recognition at about sixty per cent for everything and measure nothing.
 */
const DESCRIBING = new Set<Namespace>([
	"genre",
	"keyword",
	"director",
	"person",
	"studio",
	"series",
	"collection",
]);

/**
 * How much of what this candidate is about the profile has seen before, 0–1.
 *
 * `1` for a profile that knows nothing, because a model with no traits in it
 * cannot call anything a stranger: everything is equally unfamiliar, the term
 * would apply uniformly and change no ordering, and charging it anyway would
 * only make an empty profile's scores harder to read.
 */
function recognition(profile: TasteProfile, traits: readonly Trait[]): number {
	if (profile.traits.size === 0) return 1;
	let met = 0;
	let describing = 0;
	for (const trait of traits) {
		const ns = parseTrait(trait.key)?.ns;
		if (!ns || !DESCRIBING.has(ns)) continue;
		describing += 1;
		if (profile.traits.has(trait.key)) met += 1;
	}
	// A record carrying no description at all is a stranger by omission, which
	// is still a stranger: a search result with no genres and no cast is not a
	// suggestion anybody can act on.
	if (describing === 0) return 0;
	return met / describing;
}

/**
 * A source's score, discounted by how few people it is an average of.
 *
 * The same Bayesian shrinkage the genre affinities get, for the same reason:
 * eleven people giving something 9.4 is not evidence it is better than four
 * hundred thousand people giving something 8.6, and a recommender that takes
 * the raw average spends every slot on obscure titles with tiny samples.
 * Returns a number centred on zero — positive means better than the average
 * thing that source carries.
 */
function quality(candidate: Candidate): number {
	const score = candidate.sourceRating;
	if (score === undefined || score <= 0) return 0;
	const prior =
		(candidate.providerId ? QUALITY_PRIOR[candidate.providerId] : undefined) ??
		DEFAULT_QUALITY_PRIOR;
	// With no count there is nothing to shrink towards; taking the score at
	// face value is what the sources without vote counts deserve.
	const votes = candidate.ratingCount;
	if (votes === undefined) return score / 10 - prior.average / 10;
	const shrunk =
		(votes * score + prior.votes * prior.average) / (votes + prior.votes);
	return shrunk / 10 - prior.average / 10;
}

export interface Verdict {
	score: number;
	/**
	 * The profile's own part of the score, on its own.
	 *
	 * Kept apart from the total because the two answer different questions. The
	 * total says how good a suggestion this is, and a title three of your
	 * favourites pointed at is a good suggestion whatever else is true of it. This
	 * says whether the model thinks *you in particular* would take to it, and it
	 * is the only number that can say "you have turned this sort of thing down
	 * before" loudly enough to be worth acting on.
	 */
	fit: number;
	/** Why, in the order that mattered. Empty when nothing in it was familiar. */
	reasons: Reason[];
}

/**
 * Names most worth mentioning, so the strongest evidence is the evidence used.
 *
 * Sorted by how far from nothing each one is rather than by how positive, which
 * is not a detail. Sorting downwards and slicing meant a candidate carrying
 * three mild likes and one strong dislike kept the three and dropped the
 * dislike — the model could see everything you go for and almost nothing you
 * avoid, on precisely the candidates where avoiding it mattered most.
 *
 * A name the profile has never seen is still dropped. Unknown is not disliked.
 */
export interface Contribution {
	ns: Namespace;
	key: TraitKey;
	label: string;
	score: number;
}

function contributions(
	profile: TasteProfile,
	traits: readonly Trait[],
): Map<Namespace, Contribution[]> {
	const by = new Map<Namespace, Contribution[]>();
	for (const trait of traits) {
		const hit = profile.traits.get(trait.key);
		if (!hit) continue;
		const ns = parseTrait(trait.key)?.ns;
		if (!ns) continue;
		const row = by.get(ns);
		const one = { ns, key: trait.key, label: trait.label, score: hit.score };
		if (row) row.push(one);
		else by.set(ns, [one]);
	}
	for (const [ns, row] of by) {
		row.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
		by.set(ns, row.slice(0, NAMESPACE_CAP[ns] ?? 1));
	}
	return by;
}

/* --------------------------------------------------------- reading a profile */

export interface TraitSummary {
	key: TraitKey;
	ns: Namespace;
	label: string;
	affinity: Affinity;
}

/** What the model makes of one named thing, or nothing if it has never met it. */
export function affinity(
	profile: TasteProfile,
	ns: Namespace,
	value: string,
): Affinity | undefined {
	return profile.traits.get(traitKey(ns, value));
}

/**
 * The traits a namespace has the strongest opinion about.
 *
 * `disliked` walks the same list from the other end rather than being a
 * separate query, because "what you avoid" is not a different question — it is
 * the same number with the other sign.
 *
 * `minCount` is filtered here rather than by the caller, and that is not a
 * convenience. Every caller wanted "the top few backed by more than one title"
 * and wrote `topTraits(…, 6).filter(count >= 2)`, which slices *first* — so on
 * a library with fifteen hundred harvested keywords, where the top six by score
 * are inevitably six one-off flukes, every one of them was filtered away and the
 * result was reliably empty. The keyword and director strategies were both
 * silently dead on any real library, and the taste panel's best column was
 * blank, for this one reason.
 */
export function topTraits(
	profile: TasteProfile,
	ns: Namespace | readonly Namespace[],
	limit: number,
	direction: "liked" | "disliked" = "liked",
	minCount = 1,
): TraitSummary[] {
	const wanted = new Set<Namespace>(typeof ns === "string" ? [ns] : ns);
	const out: TraitSummary[] = [];
	for (const [key, at] of profile.traits) {
		const parsed = parseTrait(key);
		if (!parsed || !wanted.has(parsed.ns)) continue;
		if (direction === "liked" ? at.score <= 0 : at.score >= 0) continue;
		if (at.count < minCount) continue;
		out.push({
			key,
			ns: parsed.ns,
			label: profile.labels.get(key) ?? parsed.value,
			affinity: at,
		});
	}
	out.sort((a, b) =>
		direction === "liked"
			? b.affinity.score - a.affinity.score
			: a.affinity.score - b.affinity.score,
	);
	return out.slice(0, limit);
}

/**
 * How much of what you actually engage with is this kind.
 *
 * Measured against what you have opinions about, not against what is on the
 * shelf — see `KindStat`. Falls back to the shelf for a library nobody has
 * started yet, where it is the only thing there is to go on.
 */
export function kindShare(profile: TasteProfile, kind: MediaKind): number {
	const stat = profile.kinds.get(kind);
	if (!stat) return 0;
	let engaged = 0;
	let owned = 0;
	for (const at of profile.kinds.values()) {
		engaged += at.engaged;
		owned += at.owned;
	}
	if (engaged > 0) return stat.engaged / engaged;
	return owned > 0 ? stat.owned / owned : 0;
}

/**
 * The traits a candidate carries, taking whatever it was handed.
 *
 * A candidate assembled by `candidateOf`/`candidateOfItem` brings its own; one
 * written out longhand — every test does, and it is a reasonable thing to do —
 * has them worked out from its tags and names.
 */
function candidateTraits(candidate: Candidate): Trait[] {
	if (candidate.traits) return [...candidate.traits];
	const out: Trait[] = [];
	for (const tag of candidate.tags) {
		if (tag.trim()) out.push({ key: traitKey("genre", tag), label: tag.trim() });
	}
	for (const name of candidate.people.slice(0, 4)) {
		if (name.trim()) {
			out.push({ key: traitKey("person", name), label: name.trim() });
		}
	}
	if (candidate.year) {
		const decade = `${Math.floor(candidate.year / 10) * 10}s`;
		out.push({ key: traitKey("decade", decade), label: decade });
	}
	return out;
}

/**
 * How much this looks like something you would pick.
 *
 * One sum over the whole feature space, each namespace weighted by what a
 * point of affinity in it is actually worth and capped at how many of its
 * traits may speak. Then three things the profile has no say in: whether it is
 * any good by anyone's reckoning, whether you watch this sort of thing at all,
 * and whether it is out yet. And finally `STRANGER_COST`, which is about the
 * profile's say having been *nothing at all*.
 *
 * The quality term is measured against the source's own average rather than
 * zero — a 6.8 on TMDB is not a recommendation, it is a shrug.
 *
 * `kindShare` stays a term of its own rather than becoming a `kind:` trait,
 * because with per-kind baselines a kind's affinity is zero by construction:
 * every kind is now measured against itself.
 */
export function scoreCandidate(
	profile: TasteProfile,
	candidate: Candidate,
	now: Date = new Date(),
): Verdict {
	const traits = candidateTraits(candidate);
	const by = contributions(profile, traits);

	let familiar = 0;
	for (const [ns, row] of by) {
		const weight = NAMESPACE_WEIGHT[ns] ?? 1;
		for (const one of row) familiar += weight * one.score;
	}

	const merit = quality(candidate);
	const share = kindShare(profile, candidate.kind);
	const known = recognition(profile, traits);
	const stranger =
		-STRANGER_COST * (1 - Math.min(1, known / RECOGNISED_ENOUGH));

	// A nudge towards things that are actually out and reasonably current, so a
	// shelf of classics does not bury everything from this year. Nothing either
	// way for a candidate with no year: not knowing when it came out is not the
	// same as it having come out recently.
	const age = candidate.year ? now.getFullYear() - candidate.year : null;
	const freshness = age === null ? 0 : age <= 3 ? 0.05 : age > 25 ? -0.03 : 0;

	const score = familiar + 0.75 * merit + 0.35 * share + freshness + stranger;

	// Every trait that had something to say, for and against. Which of them a
	// card has room for is `rankReasons`' problem, not this function's — and
	// the dialog, which has room for all of them, wants the whole list.
	const reasons: Reason[] = [];
	for (const row of by.values()) {
		for (const one of row) {
			const kind = reasonForNamespace(one.ns);
			if (!kind) continue;
			if (Math.abs(one.score) < 0.03) continue;
			reasons.push({
				kind,
				label: one.label,
				strength: Math.min(1, Math.abs(one.score) * 4),
				ref: { trait: one.key },
				...(one.score < 0 ? { against: true as const } : {}),
			});
		}
	}
	if (merit > 0.15) {
		reasons.push({
			kind: "acclaim",
			label: "Well liked at the source",
			strength: Math.min(1, merit * 3),
		});
	}

	return { score, fit: familiar, reasons };
}

/** A candidate straight off a library note. */
export function candidateOf(
	entry: LibraryEntry,
	options: TraitOptions = {},
): Candidate {
	return {
		kind: entry.kind,
		tags: entry.tags,
		people: entry.people,
		sourceRating: entry.sourceRating,
		year: entry.year,
		providerId: entry.ref?.providerId,
		traits: traitsOfEntry(entry, options),
	};
}

/** The same, off a source record. */
export function candidateOfItem(item: MediaItem): Candidate {
	return {
		kind: item.ref.kind,
		tags: item.tags,
		people: item.people,
		sourceRating: item.rating,
		ratingCount: item.ratingCount,
		year: item.year,
		providerId: item.ref.providerId,
		traits: traitsOfItem(item),
	};
}

/**
 * Ranks, then spreads out.
 *
 * Straight ranking on a library with one dominant genre returns six of that
 * genre, which is both boring and less useful than it looks — the sixth-best
 * science fiction film adds almost nothing to a list that already has five.
 * Each pick therefore discounts the genres it used, so later places go to the
 * best thing that is not more of the same. Greedy, in the manner of maximal
 * marginal relevance, and enough: this is a shelf of six, not a search engine.
 */
export function rankDiverse<T>(
	items: readonly T[],
	scored: (item: T) => {
		score: number;
		tags: readonly string[];
		/**
		 * A coarser grouping than the tags, charged more gently.
		 *
		 * Kept separate rather than pushed in among the tags, which was the first
		 * attempt: the penalty is the *maximum* over the tags, so a group every
		 * item shares raises the floor for all of them at once and the genre
		 * spread it was meant to sit beside stops having any effect at all.
		 */
		family?: string;
	},
	limit: number,
	penalty = 0.55,
	familyPenalty = 0.15,
): T[] {
	const pool = items.map((item) => ({ item, ...scored(item) }));
	const used = new Map<string, number>();
	const families = new Map<string, number>();
	const out: T[] = [];

	while (out.length < limit && pool.length > 0) {
		let bestAt = 0;
		let bestScore = -Infinity;
		for (let i = 0; i < pool.length; i++) {
			const at = pool[i];
			if (!at) continue;
			const seen = at.tags.reduce(
				(most, tag) => Math.max(most, used.get(key(tag)) ?? 0),
				0,
			);
			const alike = at.family ? (families.get(at.family) ?? 0) : 0;
			const adjusted = at.score - seen * penalty - alike * familyPenalty;
			if (adjusted > bestScore) {
				bestScore = adjusted;
				bestAt = i;
			}
		}
		const [picked] = pool.splice(bestAt, 1);
		if (!picked) break;
		out.push(picked.item);
		for (const tag of picked.tags) {
			used.set(key(tag), (used.get(key(tag)) ?? 0) + 1);
		}
		if (picked.family) {
			families.set(picked.family, (families.get(picked.family) ?? 0) + 1);
		}
	}
	return out;
}
