import type { MediaItem } from "../core/types";
import { defaultLibraryConfig, type LibraryConfig } from "../core/library/config";
import type { LibraryEntry } from "../core/library/entry";
import type { FeedbackRecord } from "../core/library/feedback";
import {
	emptyPool,
	mergeSuggestions,
	type Origin,
	type RawSuggestion,
	type SuggestionPool,
} from "../core/library/recommend";

/**
 * The things every test about taste needs before it can say anything.
 *
 * All of this used to be copied into `taste.test.ts`, `recommend.test.ts` and
 * `home.test.ts` verbatim — the same twenty-line entry factory three times,
 * each with its own `seq` counter. Three copies of a fixture is three places to
 * update when `LibraryEntry` grows a field, and the one that gets missed fails
 * with a type error in a file nobody was touching.
 *
 * Not a test file itself: vitest only collects `src/**\/*.test.ts`, so this is
 * compiled by `tsc` and imported by tests without ever being run as one.
 */

/** Ratings out of ten, so the numbers in a test say what they look like they
 *  say — the built-in default is five, and `ratingFraction` clamps above it. */
export function testConfig(over: Partial<LibraryConfig> = {}): LibraryConfig {
	return { ...defaultLibraryConfig(), ratingScale: 10, ...over };
}

/** One fixed instant, threaded explicitly everywhere. No fake timers. */
export const NOW = new Date(2026, 7, 11);

let seq = 0;

export function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
	seq += 1;
	return {
		path: `Media/${seq}.md`,
		basename: String(seq),
		title: `Title ${seq}`,
		kind: "movie",
		tags: [],
		people: [],
		authored: [],
		favorite: false,
		history: [],
		episodeLog: {},
		collections: [],
		created: NOW.getTime(),
		modified: NOW.getTime(),
		frontmatter: {},
		...overrides,
	};
}

export function item(overrides: Partial<MediaItem> = {}): MediaItem {
	seq += 1;
	return {
		ref: { providerId: "tmdb", kind: "movie", id: String(seq) },
		title: `Item ${seq}`,
		tags: [],
		people: [],
		extra: {},
		...overrides,
	};
}

export function verdict(
	overrides: Partial<FeedbackRecord> = {},
): FeedbackRecord {
	seq += 1;
	return {
		verdict: "liked",
		at: NOW.getTime(),
		kind: "movie",
		title: `Verdict ${seq}`,
		tags: [],
		people: [],
		...overrides,
	};
}

/** A neighbour-of-your-own-titles origin, which is most of them. */
export function fromSeed(seed: string, strength = 0.8): Origin {
	return { strategy: "exploit", seed, strength };
}

/** A catalogue pick that nothing of yours pointed at. */
export const fromCatalogue: Origin = { strategy: "explore" };

export function raw(overrides: Partial<RawSuggestion> = {}): RawSuggestion {
	return {
		item: item(),
		seeds: [],
		seedStrength: 0,
		explored: false,
		strategy: "exploit",
		origins: [],
		...overrides,
	};
}

/** A pool holding one batch, as `mergeSuggestions` would have left it. */
export function pooled(
	items: readonly MediaItem[],
	origin: Origin = fromSeed("Something"),
): SuggestionPool {
	const out = emptyPool();
	mergeSuggestions(out, items, origin);
	return out;
}

/** A library that plainly likes one thing and plainly does not like another. */
export function opinionated(): LibraryEntry[] {
	return [
		entry({ tags: ["Science Fiction"], rating: 9, status: "Watched" }),
		entry({ tags: ["Science Fiction"], rating: 9, status: "Watched" }),
		entry({ tags: ["Science Fiction"], rating: 8, status: "Watched" }),
		entry({ tags: ["Romance"], rating: 3, status: "Watched" }),
		entry({ tags: ["Romance"], rating: 4, status: "Watched" }),
		entry({ tags: ["Romance"], rating: 3, status: "Watched" }),
	];
}
