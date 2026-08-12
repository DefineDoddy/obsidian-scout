import { describe, expect, it } from "vitest";
import type { MediaItem } from "../types";
import { defaultLibraryConfig } from "./config";
import type { LibraryEntry } from "./entry";
import {
	dueEntries,
	isDue,
	overdueBy,
	pruneCheckLog,
	refreshIntervalDays,
	refreshPatch,
	refreshable,
	sourceRatingKey,
} from "./refresh";

const config = defaultLibraryConfig();
const NOW = new Date(2026, 7, 11); // 11 August 2026, local

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
	return {
		path: "Media/Arrival.md",
		basename: "Arrival",
		title: "Arrival",
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
		ref: { providerId: "tmdb", kind: "movie", id: "329865" },
		...overrides,
	};
}

function item(overrides: Partial<MediaItem> = {}): MediaItem {
	return {
		ref: { providerId: "tmdb", kind: "movie", id: "329865" },
		title: "Arrival",
		tags: [],
		people: [],
		extra: {},
		...overrides,
	};
}

/** A note as the built-in film template writes it. */
function templated(extra: Record<string, unknown> = {}) {
	return {
		title: "Arrival",
		type: "movie",
		status: "Dropped",
		rating: null,
		tmdb_rating: 7.6,
		genres: ["Drama"],
		release_date: "2016-11-10",
		runtime: 116,
		cover: "https://image.tmdb.org/t/p/w500/old.jpg",
		source: "tmdb",
		scout_id: "329865",
		...extra,
	};
}

describe("refreshPatch", () => {
	it("brings the properties a note already keeps up to date", () => {
		const { values, changed } = refreshPatch(
			config,
			entry({ frontmatter: templated() }),
			item({
				rating: 8.1,
				tags: ["Drama", "Science Fiction"],
				releaseDate: "2016-11-11",
				extra: { runtime: 118 },
			}),
		);

		expect(values.tmdb_rating).toBe(8.1);
		expect(values.genres).toEqual(["Drama", "Science Fiction"]);
		expect(values.release_date).toBe("2016-11-11");
		expect(values.runtime).toBe(118);
		expect(changed).toHaveLength(4);
	});

	// The whole safety case in one test: a source's own "status" is "Released",
	// and the note's status property is the shelf the user put it on.
	it("never writes anything that belongs to the user", () => {
		const { values } = refreshPatch(
			config,
			entry({
				frontmatter: templated({
					rating: 4.5,
					progress: 3,
					started: "2026-01-01",
					favorite: true,
				}),
			}),
			item({
				rating: 8.1,
				title: "Arrival (2016)",
				imageUrl: "https://image.tmdb.org/t/p/w500/new.jpg",
				extra: { status: "Released", type: "movie" },
			}),
		);

		expect(values).not.toHaveProperty("status");
		expect(values).not.toHaveProperty("rating");
		expect(values).not.toHaveProperty("title");
		expect(values).not.toHaveProperty("cover");
		expect(values).not.toHaveProperty("progress");
		expect(values).not.toHaveProperty("started");
		expect(values).not.toHaveProperty("favorite");
		expect(values).not.toHaveProperty("type");
		expect(values).not.toHaveProperty("scout_id");
	});

	it("protects a renamed rating property too", () => {
		const renamed = { ...config, fields: { ...config.fields, rating: "score" } };
		const { values } = refreshPatch(
			renamed,
			entry({ frontmatter: { score: 4, source_rating: 7 } }),
			item({ rating: 8.8 }),
		);
		expect(values).not.toHaveProperty("score");
		expect(values.source_rating).toBe(8.8);
	});

	it("adds nothing a note does not already record", () => {
		const { values } = refreshPatch(
			config,
			entry({ frontmatter: { type: "movie", scout_id: "1" } }),
			item({ extra: { runtime: 118, tagline: "Why are they here?" } }),
		);
		expect(values).not.toHaveProperty("runtime");
		expect(values).not.toHaveProperty("tagline");
	});

	// The one exception, and the reason a note made before Scout recorded the
	// source's score starts showing one.
	it("adds the source score even when the note has none", () => {
		const { values, changed } = refreshPatch(
			config,
			entry({ frontmatter: { type: "movie" } }),
			item({ rating: 7.4 }),
		);
		expect(values.source_rating).toBe(7.4);
		expect(changed).toEqual(["source_rating"]);
	});

	it("updates the score under whatever name the note already uses", () => {
		const { values } = refreshPatch(
			config,
			entry({ frontmatter: templated() }),
			item({ rating: 7.9 }),
		);
		expect(values.tmdb_rating).toBe(7.9);
		expect(values).not.toHaveProperty("source_rating");
	});

	// Nobody has voted yet, which is not the same as a score of zero.
	it("leaves the score alone when the source has none", () => {
		const { values } = refreshPatch(
			config,
			entry({ frontmatter: templated() }),
			item({ rating: 0 }),
		);
		expect(values).not.toHaveProperty("tmdb_rating");
	});

	it("returns nothing at all when nothing has moved", () => {
		const { values, changed } = refreshPatch(
			config,
			entry({ frontmatter: templated() }),
			item({
				rating: 7.6,
				tags: ["Drama"],
				releaseDate: "2016-11-10",
				extra: { runtime: 116 },
			}),
		);
		expect(changed).toEqual([]);
		expect(values).toEqual({});
	});

	it("keeps the note's own spelling of a property", () => {
		const { values } = refreshPatch(
			config,
			entry({ frontmatter: { type: "movie", Release_Date: "2016-11-10" } }),
			item({ releaseDate: "2016-11-11" }),
		);
		expect(values.Release_Date).toBe("2016-11-11");
		expect(values).not.toHaveProperty("release_date");
	});
});

describe("sourceRatingKey", () => {
	it("prefers the property the note already has", () => {
		expect(
			sourceRatingKey(config, entry({ frontmatter: { tmdb_rating: 7 } })),
		).toBe("tmdb_rating");
	});

	it("falls back to the mapped name on a note with none", () => {
		expect(sourceRatingKey(config, entry())).toBe("source_rating");
	});
});

describe("refreshIntervalDays", () => {
	it("asks about something not out yet every few days", () => {
		expect(
			refreshIntervalDays(
				config,
				entry({ releaseDate: "2027-04-18", year: 2027 }),
				NOW,
			),
		).toBe(3);
	});

	it("asks weekly about an announcement with no date at all", () => {
		expect(refreshIntervalDays(config, entry(), NOW)).toBe(7);
	});

	it("asks weekly about a series you are part-way through", () => {
		expect(
			refreshIntervalDays(
				config,
				entry({ kind: "tv", year: 2019, status: "Watching" }),
				NOW,
			),
		).toBe(7);
	});

	it("asks fortnightly while a score is still settling", () => {
		expect(refreshIntervalDays(config, entry({ year: 2026 }), NOW)).toBe(14);
	});

	it("barely asks about something decades old", () => {
		expect(refreshIntervalDays(config, entry({ year: 1994 }), NOW)).toBe(90);
	});

	it("all but leaves a saved web page alone", () => {
		expect(refreshIntervalDays(config, entry({ kind: "link" }), NOW)).toBe(180);
	});
});

describe("overdueBy", () => {
	const old = entry({ year: 1994, created: new Date(2020, 0, 1).getTime() });

	it("counts from the last check when there has been one", () => {
		// Checked 100 days ago against a 90-day interval.
		const checked = { [old.path]: "2026-05-03" };
		expect(overdueBy(config, old, checked, NOW)).toBe(10);
	});

	// A note made today already holds what the source said today.
	it("counts from the day the note was made when it has never been checked", () => {
		expect(overdueBy(config, entry({ year: 1994 }), {}, NOW)).toBe(-90);
	});

	it("ignores a check date it cannot read", () => {
		expect(overdueBy(config, old, { [old.path]: "soon" }, NOW)).toBe(
			overdueBy(config, old, {}, NOW),
		);
	});
});

describe("isDue and dueEntries", () => {
	const stale = entry({
		path: "a.md",
		year: 1994,
		created: new Date(2020, 0, 1).getTime(),
	});
	const staler = entry({
		path: "b.md",
		year: 2027,
		releaseDate: "2027-06-01",
		created: new Date(2020, 0, 1).getTime(),
	});
	const fresh = entry({ path: "c.md", year: 1994 });

	it("leaves out a note that records no source", () => {
		expect(isDue(config, { ...stale, ref: undefined }, {}, NOW)).toBe(false);
	});

	it("takes the longest overdue first", () => {
		const picked = dueEntries([stale, staler, fresh], config, {}, NOW, 10);
		expect(picked.map((e) => e.path)).toEqual(["b.md", "a.md"]);
	});

	it("stops at the budget", () => {
		expect(dueEntries([stale, staler], config, {}, NOW, 1)).toHaveLength(1);
	});
});

describe("refreshable and pruneCheckLog", () => {
	it("counts only notes that name a source", () => {
		expect(
			refreshable([entry(), { ...entry(), ref: undefined }]),
		).toHaveLength(1);
	});

	it("forgets notes that have left the vault", () => {
		const log = { "a.md": "2026-01-01", "gone.md": "2026-01-01" };
		expect(pruneCheckLog(log, [entry({ path: "a.md" })])).toEqual({
			"a.md": "2026-01-01",
		});
	});
});
