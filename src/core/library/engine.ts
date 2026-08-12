import { isAbortError } from "../http";
import type { DiscoverQuery } from "../provider";
import type { MediaItem, MediaKind, MediaRef } from "../types";
import type { LibraryConfig } from "./config";
import type { LibraryEntry } from "./entry";
import { likedSeeds, type FeedbackLog, type ShownLog } from "./feedback";
import { anchorsOf, type Anchor } from "./neighbours";
import type { TraitOptions } from "./traits";
import {
	emptyPool,
	mergeSuggestions,
	rankSuggestions,
	recommendationSeeds,
	suggestionKey,
	type Suggestion,
	type SuggestionPool,
} from "./recommend";
import {
	planRound,
	roundsAvailable,
	type RegistryFacts,
	type Request,
	type Seed,
} from "./strategies";
import type { TasteProfile } from "./taste";

/**
 * The part that actually asks, and remembers what came back.
 *
 * This lived inside `HomeView.tsx` — a pool in a `useRef`, a `useReducer` used
 * as a repaint trigger, an `AbortController` in another ref, and a fetch
 * function rebuilt by `useCallback` on every profile change. It worked, and it
 * had no tests, because vitest collects `src/**\/*.test.ts` and it was sitting
 * in a `.tsx`. Every question worth asking about the row — does it abandon a
 * round when the seeds change under it, does it survive one source throwing,
 * does it re-rank on a thumbs-up without asking anything again — was
 * unanswerable without standing up a DOM.
 *
 * Out here it is an object with a `subscribe`, which is what the component
 * needed from it all along.
 */

/** One full rail. */
export const SHOWN = 7;

/**
 * How many of your own titles are in play across all rounds.
 *
 * Fifteen, with four asked about per round, is under four presses of "show me
 * others" before the row comes round to seeds it has already asked about. On a
 * library with a hundred and thirty things worth asking about, that is a strange
 * thing to run out of.
 *
 * Sixty-four is sixteen rounds of questions nobody has been asked yet, and on a
 * library of this size it is most of what you have finished and liked rather than
 * a quarter of it. It costs nothing to widen: the seeds are ranked here and spent
 * four at a time, so depth buys variety across presses and not one extra request.
 */
const SEED_DEPTH = 64;

/**
 * Fetches that came back with nothing new before the row admits defeat.
 *
 * Exhaustion used to be counted rather than observed: `round + 1 >=
 * roundsAvailable(...)` capped the row at four presses whether or not there was
 * anything left, and the button then disabled itself on a library that had
 * plenty more to say. Two barren fetches in a row is the real signal, and it is
 * the only one that can be right on both a library of nine and a library of nine
 * hundred.
 */
const BARREN_LIMIT = 2;

/**
 * Everything the engine needs from the outside world, as functions.
 *
 * Deliberately not the provider registry and not `ScoutContext`: a test hands
 * this an object with three scripted methods and never touches Obsidian.
 */
export interface SuggestionPort {
	facts: RegistryFacts;
	similar(
		providerId: string,
		ref: MediaRef,
		signal: AbortSignal,
	): Promise<MediaItem[]>;
	discover(
		providerId: string,
		query: DiscoverQuery,
		signal: AbortSignal,
	): Promise<MediaItem[]>;
	/** The rest of the series this one belongs to. */
	series(
		providerId: string,
		ref: MediaRef,
		signal: AbortSignal,
	): Promise<MediaItem[]>;
	/** True for anything already on a shelf. */
	owned(item: MediaItem): boolean;
}

export interface EngineInput {
	config: LibraryConfig;
	entries: readonly LibraryEntry[];
	profile: TasteProfile;
	feedback: Readonly<FeedbackLog>;
	/** When each suggestion was last drawn, so a reload rotates the row. */
	shown?: Readonly<ShownLog>;
	/** Kinds some configured source can be asked to browse. */
	kinds: readonly MediaKind[];
	/** So the favourites the anchors are built from get their full traits. */
	traitOptions?: TraitOptions;
	now?: Date;
	/**
	 * Told what the row has just drawn, so it can be written down.
	 *
	 * A callback rather than the engine reaching for the settings store,
	 * because a test then has no store to stand up — and because it makes the
	 * one direction this can flow obvious.
	 */
	onShown?: (keys: readonly string[]) => void;
}

export interface EngineState {
	shown: Suggestion[];
	loading: boolean;
	error: string | null;
	/** Nothing left to ask anybody. */
	exhausted: boolean;
	/** No seeds and no catalogue: the row should not be drawn at all. */
	idle: boolean;
}

const IDLE: EngineState = {
	shown: [],
	loading: false,
	error: null,
	exhausted: true,
	idle: true,
};

export class SuggestionEngine {
	private readonly listeners = new Set<() => void>();
	private pool: SuggestionPool = emptyPool();
	/**
	 * The rows stood aside this session, oldest first.
	 *
	 * A list of rows rather than one set of keys, so that when the pool runs thin
	 * enough that something has to come back, what comes back is the row you were
	 * looking at longest ago rather than all of them at once.
	 */
	private aside: string[][] = [];
	private live: AbortController | null = null;

	private input: EngineInput | null = null;
	private anchors: Anchor[] = [];
	/** Keys already written to the shown log, so it is stamped once each. */
	private readonly recorded = new Set<string>();
	private seeds: Seed[] = [];
	private seedKey = "";
	private round = 0;
	/** Consecutive fetches that added nothing to the pool — see `BARREN_LIMIT`. */
	private barren = 0;
	private loading = false;
	private error: string | null = null;
	private cached: EngineState | null = null;

	constructor(private readonly port: SuggestionPort) {}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Hands the engine the current world.
	 *
	 * Called on every render. Refetching happens only when the *seeds* change,
	 * because a new rating can change what the row should be asking about,
	 * while a thumbs-up only changes how the answers already in hand are
	 * ordered — and re-asking on a thumbs-up would make the button feel like it
	 * had thrown the row away.
	 */
	update(input: EngineInput): void {
		const previous = this.seedKey;
		this.input = input;
		this.anchors = anchorsOf(
			input.config,
			input.entries,
			input.feedback,
			input.traitOptions ?? {},
		);
		this.seeds = recommendationSeeds(
			input.config,
			input.entries,
			SEED_DEPTH,
			input.now ?? new Date(),
		);
		this.seedKey = this.seeds.map((at) => at.entry.path).join("|");
		this.cached = null;

		if (this.seedKey !== previous) {
			this.live?.abort();
			this.pool = emptyPool();
			this.round = 0;
			this.barren = 0;
			this.error = null;
			void this.fetch(0);
		}
	}

	state(): EngineState {
		const input = this.input;
		if (!input) return IDLE;
		if (this.seeds.length === 0 && input.kinds.length === 0) return IDLE;
		if (this.cached) return this.cached;

		// What has been stood aside is a preference, not a rule. Treated as a rule
		// it emptied the row: press "show me others" as many times as the pool is
		// deep and every candidate is on the list, so the row went blank and the
		// button stopped doing anything — on a row whose whole promise is that
		// there is always something else.
		//
		// Released a row at a time and oldest first. Dropping the whole hold at
		// once brought back everything you had just skipped past along with
		// everything else, which is the difference between coming round and going
		// in circles. The row stood aside most recently is never released.
		let shown = this.rank(input, this.held());
		for (let from = 1; shown.length < SHOWN && from < this.aside.length; from++) {
			const wider = this.rank(input, this.held(from));
			if (wider.length > shown.length) shown = wider;
		}
		this.record(shown);

		this.cached = {
			shown,
			loading: this.loading,
			error: this.error,
			exhausted: this.exhausted(),
			idle: false,
		};
		return this.cached;
	}

	/**
	 * Everything on screen steps aside and the next best takes its place.
	 *
	 * Another round is only asked for once the pool actually runs thin — the
	 * answers already in hand are usually deeper than seven.
	 *
	 * The press always does something. Once the sources have genuinely run out
	 * the row comes round again rather than going blank: `state` gives back the
	 * rows you saw longest ago, a row at a time, and never the one you were just
	 * looking at. Going round is a worse answer than a new answer and a far
	 * better one than nothing.
	 */
	more(): void {
		const state = this.state();
		const row = state.shown.map((at) => suggestionKey(at.item));
		if (row.length > 0) this.aside.push(row);
		this.cached = null;

		const left = this.pool.by.size - this.held().size;
		if (left < SHOWN && !this.exhausted()) {
			this.round += 1;
			void this.fetch(this.round);
			return;
		}
		this.emit();
	}

	/** Forgets what has been stood aside, so the whole pool is back in play. */
	reset(): void {
		this.aside = [];
		this.cached = null;
		this.emit();
	}

	/** Everything stood aside from the `from`th row onwards. */
	private held(from = 0): Set<string> {
		const out = new Set<string>();
		for (let at = from; at < this.aside.length; at++) {
			for (const key of this.aside[at] ?? []) out.add(key);
		}
		return out;
	}

	private rank(
		input: EngineInput,
		skipped: ReadonlySet<string>,
	): Suggestion[] {
		return rankSuggestions(this.pool, input.profile, {
			limit: SHOWN,
			owned: (item) => this.port.owned(item),
			feedback: input.feedback,
			skipped,
			...(input.shown ? { shown: input.shown } : {}),
			anchors: this.anchors,
			...(input.now ? { now: input.now } : {}),
		});
	}

	dispose(): void {
		this.live?.abort();
		this.live = null;
		this.listeners.clear();
	}

	/**
	 * Whether there is any point asking again.
	 *
	 * `roundsAvailable` is consulted for whether there is anybody to ask at all
	 * rather than for how many times they may be asked: the planners come round
	 * to the start of their lists, so there is always another question, and
	 * whether it is worth putting is answered by what the last two came back
	 * with.
	 */
	private exhausted(): boolean {
		const kinds = this.input?.kinds ?? [];
		if (roundsAvailable(this.seeds, kinds) === 0) return true;
		return this.barren >= BARREN_LIMIT;
	}

	private async fetch(round: number): Promise<void> {
		const input = this.input;
		if (!input) return;

		const requests = planRound(
			{
				profile: input.profile,
				seeds: this.seeds,
				kinds: input.kinds,
				facts: this.port.facts,
				liked: likedSeeds(input.feedback, (ref) =>
					this.port.owned({
						ref,
						title: "",
						tags: [],
						people: [],
						extra: {},
					}),
				),
				...(input.traitOptions?.enrichment
					? { enrichment: input.traitOptions.enrichment }
					: {}),
			},
			round,
		);
		if (requests.length === 0) {
			this.barren += 1;
			return;
		}

		const before = this.pool.by.size;
		this.live?.abort();
		const controller = new AbortController();
		this.live = controller;
		this.loading = true;
		this.error = null;
		this.cached = null;
		this.emit();

		// One source being unreachable must not empty the row, so a failure is
		// remembered and only shown if nothing at all came back.
		let failure: string | null = null;
		const note = (err: unknown) => {
			if (controller.signal.aborted || isAbortError(err)) return;
			console.warn("Scout: could not ask a source for suggestions", err);
			failure ??=
				err instanceof Error ? err.message : "Could not reach the source.";
		};

		await Promise.all(
			requests.map((request) =>
				this.run(request, controller.signal)
					.then((items) => {
						if (controller.signal.aborted) return;
						mergeSuggestions(this.pool, items, request.origin);
					})
					.catch(note),
			),
		);

		if (controller.signal.aborted) return;
		this.live = null;
		this.loading = false;
		this.error = failure;
		// A round that asked and learned nothing is the only honest sign that the
		// sources have run dry. Counted rather than reset on the first miss,
		// because one round can legitimately return only titles already pooled.
		if (this.pool.by.size > before) this.barren = 0;
		else this.barren += 1;
		this.cached = null;
		this.emit();
	}

	private run(request: Request, signal: AbortSignal): Promise<MediaItem[]> {
		if (request.op === "similar" && request.ref) {
			return this.port.similar(request.providerId, request.ref, signal);
		}
		if (request.op === "series" && request.ref) {
			return this.port.series(request.providerId, request.ref, signal);
		}
		if (request.op === "discover" && request.query) {
			return this.port.discover(request.providerId, request.query, signal);
		}
		return Promise.resolve([]);
	}

	/**
	 * Writes down what is on screen, once per key.
	 *
	 * Stamped when the row is *drawn* rather than when "show me others" is
	 * pressed, which is what makes a reload alone rotate it: the seven you saw
	 * last night were seen, whether or not you did anything about them.
	 */
	private record(shown: readonly Suggestion[]): void {
		const report = this.input?.onShown;
		if (!report) return;
		const fresh = shown
			.map((at) => suggestionKey(at.item))
			.filter((key) => !this.recorded.has(key));
		if (fresh.length === 0) return;
		for (const key of fresh) this.recorded.add(key);
		report(fresh);
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}
}
