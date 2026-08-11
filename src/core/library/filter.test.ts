import { describe, expect, it } from "vitest";
import type { MediaKind } from "../types";
import { defaultLibraryConfig, type LibraryConfig } from "./config";
import type { LibraryEntry } from "./entry";
import {
	collectTags,
	emptyQuery,
	filterEntries,
	groupEntries,
	libraryStats,
	sortEntries,
	type LibraryQuery,
} from "./filter";

const config = defaultLibraryConfig();

/** The same vault, but films are scored out of ten and books out of five. */
const mixed: LibraryConfig = {
	...config,
	ratingScales: { movie: 10 },
};

function entry(
	title: string,
	overrides: Partial<LibraryEntry> = {},
): LibraryEntry {
	return {
		path: `Media/${title}.md`,
		basename: title,
		title,
		kind: "movie" as MediaKind,
		tags: [],
		people: [],
		favorite: false,
		created: 0,
		modified: 0,
		frontmatter: {},
		...overrides,
	};
}

const LIBRARY: LibraryEntry[] = [
	entry("Arrival", {
		year: 2016,
		rating: 4.5,
		status: "Watched",
		tags: ["Drama", "Science Fiction"],
		people: ["Denis Villeneuve"],
		modified: 300,
	}),
	entry("Dune", {
		year: 2021,
		rating: 4,
		status: "Watching",
		tags: ["Science Fiction"],
		people: ["Denis Villeneuve"],
		favorite: true,
		modified: 200,
		progress: 1,
		progressTotal: 2,
	}),
	entry("Piranesi", {
		kind: "book",
		year: 2020,
		status: "To read",
		tags: ["Fantasy"],
		people: ["Susanna Clarke"],
		modified: 100,
	}),
];

function query(overrides: Partial<LibraryQuery> = {}): LibraryQuery {
	return { ...emptyQuery(config), ...overrides };
}

describe("filterEntries", () => {
	it("matches title, people, tags, and status", () => {
		expect(filterEntries(LIBRARY, query({ text: "dune" }), config)).toHaveLength(
			1,
		);
		expect(
			filterEntries(LIBRARY, query({ text: "villeneuve" }), config),
		).toHaveLength(2);
		expect(
			filterEntries(LIBRARY, query({ text: "fantasy" }), config),
		).toHaveLength(1);
		expect(
			filterEntries(LIBRARY, query({ text: "watching" }), config),
		).toHaveLength(1);
	});

	it("requires every word of a multi-word query", () => {
		expect(
			filterEntries(LIBRARY, query({ text: "villeneuve arrival" }), config),
		).toHaveLength(1);
		expect(
			filterEntries(LIBRARY, query({ text: "villeneuve piranesi" }), config),
		).toHaveLength(0);
	});

	it("filters by kind and by status, ignoring case", () => {
		expect(
			filterEntries(LIBRARY, query({ kinds: ["book"] }), config),
		).toHaveLength(1);
		expect(
			filterEntries(LIBRARY, query({ statuses: ["watched"] }), config),
		).toHaveLength(1);
	});

	it("excludes unrated entries from a minimum rating", () => {
		const kept = filterEntries(LIBRARY, query({ minRating: 4 }), config);
		expect(kept.map((e) => e.title)).toEqual(["Arrival", "Dune"]);
		expect(
			filterEntries(LIBRARY, query({ minRating: 4.5 }), config),
		).toHaveLength(1);
	});

	it("compares a minimum rating proportionally across scales", () => {
		// Out of ten, 4 and 4.5 are poor scores — neither reaches 4 out of 5.
		expect(
			filterEntries(LIBRARY, query({ minRating: 4 }), mixed),
		).toHaveLength(0);
		// 1.5 out of 5 is 30%, which both of them clear.
		expect(
			filterEntries(LIBRARY, query({ minRating: 1.5 }), mixed).map(
				(e) => e.title,
			),
		).toEqual(["Arrival", "Dune"]);
	});

	it("keeps a rating that sits exactly on the threshold", () => {
		expect(
			filterEntries([entry("Exact", { rating: 8 })], query({ minRating: 4 }), mixed),
		).toHaveLength(1);
	});

	it("combines filters rather than widening", () => {
		expect(
			filterEntries(
				LIBRARY,
				query({ kinds: ["movie"], favoritesOnly: true }),
				config,
			).map((e) => e.title),
		).toEqual(["Dune"]);
	});

	it("requires all of the selected tags", () => {
		expect(
			filterEntries(
				LIBRARY,
				query({ tags: ["drama", "science fiction"] }),
				config,
			).map((e) => e.title),
		).toEqual(["Arrival"]);
	});
});

describe("sortEntries", () => {
	it("sinks unrated entries to the bottom whichever way rating sorts", () => {
		expect(
			sortEntries(LIBRARY, "rating-desc", config).map((e) => e.title),
		).toEqual(["Arrival", "Dune", "Piranesi"]);
		expect(
			sortEntries(LIBRARY, "rating-asc", config).map((e) => e.title),
		).toEqual(["Dune", "Arrival", "Piranesi"]);
	});

	it("ranks by proportion of the scale, not the raw number", () => {
		const entries = [
			entry("Film", { rating: 7 }), // 7/10 — 70%
			entry("Novel", { kind: "book", rating: 4 }), // 4/5 — 80%
		];
		expect(sortEntries(entries, "rating-desc", mixed).map((e) => e.title)).toEqual(
			["Novel", "Film"],
		);
		// On a single scale the raw numbers win instead.
		expect(
			sortEntries(entries, "rating-desc", config).map((e) => e.title),
		).toEqual(["Film", "Novel"]);
	});

	it("orders by the configured status sequence, not alphabetically", () => {
		const ordered = sortEntries(LIBRARY, "status", config).map(
			(e) => e.status,
		);
		// "To read" is first in the book vocabulary, "Watching" second for films.
		expect(ordered[0]).toBe("To read");
		expect(ordered[2]).toBe("Watched");
	});

	it("separates when a note was made from when it was last touched", () => {
		const entries = [
			entry("Old note, edited today", { created: 1, modified: 900 }),
			entry("Added yesterday", { created: 500, modified: 500 }),
		];
		expect(sortEntries(entries, "added", config).map((e) => e.title)).toEqual([
			"Added yesterday",
			"Old note, edited today",
		]);
		expect(sortEntries(entries, "recent", config).map((e) => e.title)).toEqual([
			"Old note, edited today",
			"Added yesterday",
		]);
	});

	it("reverses the title sort", () => {
		expect(sortEntries(LIBRARY, "title-desc", config).map((e) => e.title)).toEqual(
			["Piranesi", "Dune", "Arrival"],
		);
	});

	it("does not modify the array it was given", () => {
		const before = LIBRARY.map((e) => e.title);
		sortEntries(LIBRARY, "title", config);
		expect(LIBRARY.map((e) => e.title)).toEqual(before);
	});
});

describe("groupEntries", () => {
	it("returns one group when grouping is off", () => {
		const groups = groupEntries(LIBRARY, "none", config);
		expect(groups).toHaveLength(1);
		expect(groups[0]?.entries).toHaveLength(3);
	});

	it("groups by kind", () => {
		const groups = groupEntries(LIBRARY, "kind", config);
		expect(groups.map((g) => g.key).sort()).toEqual(["book", "movie"]);
	});

	it("puts the unknown bucket last", () => {
		const withGap = [...LIBRARY, entry("Unlabelled")];
		const groups = groupEntries(withGap, "status", config);
		expect(groups[groups.length - 1]?.key).toBe("~none");
	});

	it("buckets mixed scales onto shared shelves", () => {
		const entries = [
			entry("Film", { rating: 8 }), // 8/10
			entry("Novel", { kind: "book", rating: 4 }), // 4/5
		];
		const groups = groupEntries(entries, "rating", mixed);
		expect(groups).toHaveLength(1);
		expect(groups[0]?.label).toBe("4+");
	});

	it("orders decades newest first", () => {
		const groups = groupEntries(LIBRARY, "decade", config);
		expect(groups.map((g) => g.label)).toEqual(["2020s", "2010s"]);
	});

	it("puts an entry on every one of its genres", () => {
		const groups = groupEntries(LIBRARY, "genre", config);
		const scifi = groups.find((g) => g.key === "science fiction");
		const drama = groups.find((g) => g.key === "drama");
		expect(scifi?.entries.map((e) => e.title)).toEqual(["Arrival", "Dune"]);
		expect(drama?.entries.map((e) => e.title)).toEqual(["Arrival"]);
	});

	it("orders genres by size, biggest shelf first", () => {
		const groups = groupEntries(LIBRARY, "genre", config);
		expect(groups.map((g) => g.label)).toEqual([
			"Science Fiction",
			"Drama",
			"Fantasy",
		]);
	});

	it("shelves an entry with no genre under the last group", () => {
		const groups = groupEntries([...LIBRARY, entry("Bare")], "genre", config);
		const last = groups[groups.length - 1];
		expect(last?.key).toBe("~none");
		expect(last?.entries.map((e) => e.title)).toEqual(["Bare"]);
	});

	it("puts an entry on its first genre only", () => {
		const groups = groupEntries(LIBRARY, "genre-main", config);
		// Arrival is drama first, science fiction second, so it is not on the
		// science-fiction shelf at all this time.
		expect(groups.find((g) => g.key === "drama")?.entries).toHaveLength(1);
		expect(
			groups.find((g) => g.key === "science fiction")?.entries.map((e) => e.title),
		).toEqual(["Dune"]);
		const total = groups.reduce((sum, g) => sum + g.entries.length, 0);
		expect(total).toBe(LIBRARY.length);
	});

	it("shelves a genre-less entry under the last group when grouping by main genre", () => {
		const groups = groupEntries(
			[...LIBRARY, entry("Bare")],
			"genre-main",
			config,
		);
		expect(groups[groups.length - 1]?.key).toBe("~none");
	});

	it("groups the same person's work together", () => {
		const groups = groupEntries(LIBRARY, "person", config);
		expect(groups[0]?.label).toBe("Denis Villeneuve");
		expect(groups[0]?.entries).toHaveLength(2);
	});

	it("splits favourites from the rest", () => {
		const groups = groupEntries(LIBRARY, "favorite", config);
		expect(groups.map((g) => g.label)).toEqual([
			"Favourites",
			"Everything else",
		]);
		expect(groups[0]?.entries.map((e) => e.title)).toEqual(["Dune"]);
	});
});

describe("libraryStats", () => {
	it("counts what is in progress and what is finished", () => {
		const stats = libraryStats(LIBRARY, config);
		expect(stats.total).toBe(3);
		expect(stats.inProgress).toBe(1);
		expect(stats.finished).toBe(1);
		expect(stats.favorites).toBe(1);
		expect(stats.rated).toBe(2);
		expect(stats.averageRating).toBeCloseTo(4.25);
	});

	it("averages onto the default scale", () => {
		const entries = [
			entry("Film", { rating: 8 }), // 8/10 -> 4/5
			entry("Novel", { kind: "book", rating: 5 }), // 5/5
		];
		expect(libraryStats(entries, mixed).averageRating).toBeCloseTo(4.5);
	});

	it("reports no average when nothing is rated", () => {
		expect(libraryStats([entry("x")], config).averageRating).toBeNull();
	});
});

describe("collectTags", () => {
	it("lists genres most common first", () => {
		expect(collectTags(LIBRARY)[0]).toBe("Science Fiction");
	});
});
