import { describe, expect, it } from "vitest";
import type { SeasonInfo } from "../types";
import {
	episodeKey,
	episodeLabel,
	isEpisodicKind,
	isWatched,
	nextEpisode,
	parseEpisodeKey,
	previousEpisode,
	countWatched,
	markUpTo,
	readEpisodeLog,
	readWatchedSet,
	toggleWatched,
	watchedCount,
	watchedUpTo,
	writeEpisodeLog,
	writeWatchedSet,
	type EpisodeId,
	type WatchState,
} from "./episodes";

/** A show with specials, so season zero is in the way of every count. */
const seasons: SeasonInfo[] = [
	{ number: 0, name: "Specials", episodeCount: 3 },
	{ number: 1, name: "Season 1", episodeCount: 10 },
	{ number: 2, name: "Season 2", episodeCount: 8 },
	{ number: 3, name: "Season 3", episodeCount: 6 },
];

describe("isEpisodicKind", () => {
	// TMDB answers for episodes whatever you ask it about, which is how every
	// film in the library came to advertise a season list it did not have.
	it("is true only for the things that come in episodes", () => {
		expect(isEpisodicKind("tv")).toBe(true);
		expect(isEpisodicKind("anime")).toBe(true);
		expect(isEpisodicKind("movie")).toBe(false);
		expect(isEpisodicKind("book")).toBe(false);
		expect(isEpisodicKind("game")).toBe(false);
	});
});

describe("episodeKey", () => {
	it("pads to the form every episode guide uses", () => {
		expect(episodeKey(2, 5)).toBe("S02E05");
		expect(episodeKey(1, 12)).toBe("S01E12");
		expect(episodeKey(0, 1)).toBe("S00E01");
		expect(episodeKey(12, 130)).toBe("S12E130");
	});
});

describe("episodeLabel", () => {
	it("separates the season from the episode for reading", () => {
		expect(episodeLabel(2, 5)).toBe("S02 E05");
		expect(episodeLabel(1, 13)).toBe("S01 E13");
		expect(episodeLabel(12, 130)).toBe("S12 E130");
	});

	// The label is shown, and what is shown gets typed back into the note.
	it("round-trips back through the parser", () => {
		expect(parseEpisodeKey(episodeLabel(2, 5))).toEqual({
			season: 2,
			episode: 5,
		});
	});
});

describe("parseEpisodeKey", () => {
	it("reads what Scout writes", () => {
		expect(parseEpisodeKey("S02E05")).toEqual({ season: 2, episode: 5 });
	});

	it("reads what a person types", () => {
		expect(parseEpisodeKey("s2e5")).toEqual({ season: 2, episode: 5 });
		expect(parseEpisodeKey("2x05")).toEqual({ season: 2, episode: 5 });
		expect(parseEpisodeKey("Season 2 Episode 5")).toEqual({
			season: 2,
			episode: 5,
		});
		expect(parseEpisodeKey(" S02 E05 ")).toEqual({ season: 2, episode: 5 });
	});

	// A run with no seasons worth naming — most anime — is season one.
	it("takes a bare number as an episode of the first season", () => {
		expect(parseEpisodeKey("14")).toEqual({ season: 1, episode: 14 });
		expect(parseEpisodeKey(14)).toEqual({ season: 1, episode: 14 });
	});

	it("refuses anything that is not an episode", () => {
		expect(parseEpisodeKey(undefined)).toBeNull();
		expect(parseEpisodeKey("")).toBeNull();
		expect(parseEpisodeKey("finale")).toBeNull();
		expect(parseEpisodeKey(0)).toBeNull();
		expect(parseEpisodeKey(true)).toBeNull();
	});
});

describe("isWatched", () => {
	const marker = { season: 2, episode: 5 };

	it("counts everything up to and including the marker", () => {
		expect(isWatched({ season: 1, episode: 10 }, marker)).toBe(true);
		expect(isWatched({ season: 2, episode: 4 }, marker)).toBe(true);
		expect(isWatched({ season: 2, episode: 5 }, marker)).toBe(true);
	});

	it("counts nothing after it, and nothing at all without one", () => {
		expect(isWatched({ season: 2, episode: 6 }, marker)).toBe(false);
		expect(isWatched({ season: 3, episode: 1 }, marker)).toBe(false);
		expect(isWatched({ season: 1, episode: 1 }, null)).toBe(false);
	});
});

describe("watchedCount", () => {
	it("adds up the seasons before the marker", () => {
		expect(watchedCount(seasons, { season: 1, episode: 4 })).toBe(4);
		expect(watchedCount(seasons, { season: 2, episode: 5 })).toBe(15);
		expect(watchedCount(seasons, { season: 3, episode: 6 })).toBe(24);
	});

	// Specials are not part of the run anyone means by "how far through".
	it("leaves the specials out of it", () => {
		expect(watchedCount(seasons, { season: 0, episode: 2 })).toBe(0);
	});
});

describe("nextEpisode", () => {
	it("moves along the season, then onto the next one", () => {
		expect(nextEpisode(seasons, { season: 2, episode: 5 })).toEqual({
			season: 2,
			episode: 6,
		});
		expect(nextEpisode(seasons, { season: 2, episode: 8 })).toEqual({
			season: 3,
			episode: 1,
		});
	});

	it("starts at the first real episode when nothing is marked", () => {
		expect(nextEpisode(seasons, null)).toEqual({ season: 1, episode: 1 });
	});

	it("has nothing to offer at the end of the run", () => {
		expect(nextEpisode(seasons, { season: 3, episode: 6 })).toBeNull();
	});
});

describe("previousEpisode", () => {
	it("steps back a season when it runs off the front of one", () => {
		expect(previousEpisode(seasons, { season: 2, episode: 5 })).toEqual({
			season: 2,
			episode: 4,
		});
		expect(previousEpisode(seasons, { season: 2, episode: 1 })).toEqual({
			season: 1,
			episode: 10,
		});
	});

	// Un-ticking the very first episode means you have watched none of it.
	it("returns nothing before the beginning", () => {
		expect(previousEpisode(seasons, { season: 1, episode: 1 })).toBeNull();
	});
});

describe("readEpisodeLog", () => {
	it("reads the list form Scout writes", () => {
		expect(
			readEpisodeLog([
				"S01E01 | 9",
				"S01E02 | 7 | the boat one",
				"S01E03 |  | no score, still an opinion",
			]),
		).toEqual({
			S01E01: { rating: 9 },
			S01E02: { rating: 7, note: "the boat one" },
			S01E03: { note: "no score, still an opinion" },
		});
	});

	// Notes get typed by hand into the property editor, and a pipe in one
	// should not silently truncate it.
	it("keeps a separator that appears inside the note", () => {
		expect(readEpisodeLog(["S01E01 | 8 | good | but long"])).toEqual({
			S01E01: { rating: 8, note: "good | but long" },
		});
	});

	it("takes a single trailing part as whichever it looks like", () => {
		expect(readEpisodeLog(["S01E01 | brilliant"])).toEqual({
			S01E01: { note: "brilliant" },
		});
	});

	it("takes a bare number as a rating", () => {
		expect(readEpisodeLog({ S01E01: 9 })).toEqual({ S01E01: { rating: 9 } });
	});

	it("takes a map as both", () => {
		expect(readEpisodeLog({ S01E02: { rating: 7, note: "the boat one" } })).toEqual(
			{ S01E02: { rating: 7, note: "the boat one" } },
		);
	});

	it("takes a plain string as a note", () => {
		expect(readEpisodeLog({ S01E03: "brilliant" })).toEqual({
			S01E03: { note: "brilliant" },
		});
	});

	// Hand-written keys are the same episodes as generated ones.
	it("normalizes the keys it is given", () => {
		expect(readEpisodeLog({ "2x05": 8, s3e1: 6 })).toEqual({
			S02E05: { rating: 8 },
			S03E01: { rating: 6 },
		});
	});

	it("drops anything it cannot make sense of", () => {
		expect(readEpisodeLog({ finale: 9, S01E01: null })).toEqual({});
		expect(readEpisodeLog(undefined)).toEqual({});
		expect(readEpisodeLog(["S01E01"])).toEqual({});
		expect(readEpisodeLog(["finale | 9", 7])).toEqual({});
	});
});

describe("writeEpisodeLog", () => {
	// Obsidian's property editor has no type for a nested map and shows one as
	// raw JSON under a question mark, which reads as a corrupted note.
	it("writes a list of lines, not a map", () => {
		expect(writeEpisodeLog({ S01E01: { rating: 9 } })).toEqual(["S01E01 | 9"]);
	});

	it("puts the note after the score, and keeps the gap when there is none", () => {
		expect(
			writeEpisodeLog({
				S01E01: { rating: 9 },
				S01E02: { rating: 7, note: "hm" },
				S01E03: { note: "no rating, still an opinion" },
			}),
		).toEqual([
			"S01E01 | 9",
			"S01E02 | 7 | hm",
			"S01E03 |  | no rating, still an opinion",
		]);
	});

	// So clearing the last entry removes the property rather than leaving `{}`.
	it("comes back null once nothing is left in it", () => {
		expect(writeEpisodeLog({})).toBeNull();
		expect(writeEpisodeLog({ S01E01: {} })).toBeNull();
	});

	it("round-trips whatever it wrote", () => {
		const log = {
			S01E01: { rating: 9 },
			S02E05: { rating: 7, note: "the boat one" },
		};
		expect(readEpisodeLog(writeEpisodeLog(log))).toEqual(log);
	});
});

/* --------------------------------------------------- watched out of order */

const state = (marker: EpisodeId | null, ...extra: string[]): WatchState => ({
	marker,
	extra: new Set(extra),
});

/** The set of keys, so a comparison reads as a set rather than as an order. */
const seen = (result: WatchState): string[] => [...result.extra].sort();

describe("readWatchedSet", () => {
	it("takes a list, a line, or whatever spelling the note used", () => {
		expect([...readWatchedSet(["S01E02", "2x05", "s3e1"])].sort()).toEqual([
			"S01E02",
			"S02E05",
			"S03E01",
		]);
		expect([...readWatchedSet("S01E02, S01E04")].sort()).toEqual([
			"S01E02",
			"S01E04",
		]);
	});

	it("drops what it cannot read rather than inventing an episode", () => {
		expect([...readWatchedSet(["", "the boat one", null])]).toEqual([]);
		expect(writeWatchedSet(new Set())).toBeNull();
	});
});

describe("toggleWatched", () => {
	it("ticks one episode without claiming the ones before it", () => {
		const next = toggleWatched(seasons, state(null), { season: 3, episode: 4 });
		expect(next.marker).toBeNull();
		expect(seen(next)).toEqual(["S03E04"]);
		expect(isWatched({ season: 3, episode: 1 }, next.marker, next.extra)).toBe(
			false,
		);
	});

	// The marker is the better record when it is true, so watching straight on
	// moves it rather than growing a list that says the same thing.
	it("moves the marker when the tick is the next one along", () => {
		const next = toggleWatched(seasons, state({ season: 1, episode: 4 }), {
			season: 1,
			episode: 5,
		});
		expect(next.marker).toEqual({ season: 1, episode: 5 });
		expect(seen(next)).toEqual([]);
	});

	it("swallows the loose ticks the run has caught up with", () => {
		const next = toggleWatched(
			seasons,
			state({ season: 1, episode: 4 }, "S01E06", "S01E07", "S02E01"),
			{ season: 1, episode: 5 },
		);
		expect(next.marker).toEqual({ season: 1, episode: 7 });
		expect(seen(next)).toEqual(["S02E01"]);
	});

	it("un-ticks a loose one on its own", () => {
		const next = toggleWatched(seasons, state(null, "S03E04"), {
			season: 3,
			episode: 4,
		});
		expect(seen(next)).toEqual([]);
	});

	it("steps the marker back when the tick is the marker itself", () => {
		const next = toggleWatched(seasons, state({ season: 2, episode: 1 }), {
			season: 2,
			episode: 1,
		});
		expect(next.marker).toEqual({ season: 1, episode: 10 });
	});

	/**
	 * The case a single marker cannot say at all: a hole in the middle. The set
	 * of episodes you have seen must not change apart from the one un-ticked.
	 */
	it("writes the run out in full when a hole is punched in it", () => {
		const next = toggleWatched(seasons, state({ season: 2, episode: 3 }), {
			season: 1,
			episode: 8,
		});
		expect(next.marker).toEqual({ season: 1, episode: 7 });
		expect(seen(next)).toEqual([
			"S01E09",
			"S01E10",
			"S02E01",
			"S02E02",
			"S02E03",
		]);
		expect(isWatched({ season: 1, episode: 8 }, next.marker, next.extra)).toBe(
			false,
		);
		expect(isWatched({ season: 2, episode: 3 }, next.marker, next.extra)).toBe(
			true,
		);
	});

	// Specials are numbered season zero everywhere and are not part of the run
	// the marker counts, so they can only ever be loose ticks.
	it("keeps specials out of the marker", () => {
		const next = toggleWatched(seasons, state(null), { season: 0, episode: 1 });
		expect(next.marker).toBeNull();
		expect(seen(next)).toEqual(["S00E01"]);
	});
});

describe("markUpTo", () => {
	it("fills everything in behind it and drops what it now covers", () => {
		const next = markUpTo(seasons, state(null, "S01E03", "S03E01"), {
			season: 2,
			episode: 2,
		});
		expect(next.marker).toEqual({ season: 2, episode: 2 });
		expect(seen(next)).toEqual(["S03E01"]);
	});

	it("has nothing to offer where the run is already complete", () => {
		const full = state({ season: 2, episode: 2 });
		expect(watchedUpTo(seasons, full, { season: 2, episode: 2 })).toBe(true);
		expect(watchedUpTo(seasons, full, { season: 2, episode: 3 })).toBe(false);
		expect(
			watchedUpTo(seasons, state(null, "S01E01"), { season: 1, episode: 1 }),
		).toBe(true);
	});
});

describe("countWatched", () => {
	it("counts both ways of having watched something, once each", () => {
		// Ten in season one, five into season two, plus one loose in season
		// three. The special does not count towards the run.
		expect(
			countWatched(
				seasons,
				state({ season: 2, episode: 5 }, "S03E02", "S00E01", "S01E04"),
			),
		).toBe(16);
	});

	it("is nothing at all when nothing has been watched", () => {
		expect(countWatched(seasons, state(null))).toBe(0);
	});
});
