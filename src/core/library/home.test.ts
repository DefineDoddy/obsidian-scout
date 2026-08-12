import { describe, expect, it } from "vitest";
import { entry, NOW } from "../../test/fixtures";
import { defaultLibraryConfig } from "./config";
import type { LibraryEntry } from "./entry";
import { buildHome } from "./home";
import { buildTaste } from "./taste";

/** The built-in scale, unlike the taste tests — nothing here reads a rating. */
const config = defaultLibraryConfig();

const home = (entries: LibraryEntry[]) =>
	buildHome(config, entries, buildTaste(config, entries, NOW), NOW);

describe("buildHome", () => {
	it("sorts by tone, whatever the shelf is called", () => {
		const result = home([
			entry({ title: "Going", status: "Watching" }),
			entry({ title: "Parked", status: "On hold" }),
			entry({ title: "Waiting", status: "To watch" }),
			entry({ title: "Over", status: "Watched" }),
			entry({ title: "Gone", status: "Dropped" }),
		]);
		expect(result.continuing.map((e) => e.title)).toEqual(["Going"]);
		expect(result.onHold.map((e) => e.title)).toEqual(["Parked"]);
		expect(result.upNext.map((e) => e.title)).toEqual(["Waiting"]);
		expect(result.recent.map((e) => e.title)).toEqual(["Over"]);
	});

	// A note with no status is one you have not got to yet, not one to lose.
	it("offers a note with no status at all", () => {
		expect(home([entry({ title: "Bare" })]).upNext.map((e) => e.title)).toEqual([
			"Bare",
		]);
	});

	it("puts what you touched last at the front of what you are in the middle of", () => {
		const result = home([
			entry({ title: "Old", status: "Watching", modified: 1_000 }),
			entry({ title: "New", status: "Watching", modified: 9_000_000_000_000 }),
		]);
		expect(result.continuing[0]?.title).toBe("New");
	});

	/**
	 * The point of the row: forty unstarted things sorted by title answers
	 * nothing, and "what should I start" is the question being asked.
	 */
	it("ranks the shelf by what the library says you like", () => {
		const result = home([
			entry({ tags: ["Science Fiction"], rating: 9, status: "Watched" }),
			entry({ tags: ["Science Fiction"], rating: 9, status: "Watched" }),
			entry({ tags: ["Romance"], rating: 2, status: "Watched" }),
			entry({ tags: ["Romance"], rating: 3, status: "Watched" }),
			entry({ title: "Soppy", tags: ["Romance"], status: "To watch" }),
			entry({ title: "Spaceships", tags: ["Science Fiction"], status: "To watch" }),
		]);
		expect(result.upNext[0]?.title).toBe("Spaceships");
	});

	it("keeps something not out yet off the shelf row and on the countdown", () => {
		const result = home([
			entry({
				title: "Next year",
				status: "To watch",
				releaseDate: "2027-04-18",
			}),
		]);
		expect(result.upNext).toHaveLength(0);
		expect(result.upcoming).toHaveLength(1);
		expect(result.upcoming[0]?.when).toBe("Out in 8 months");
	});

	it("leaves out something already released", () => {
		expect(home([entry({ releaseDate: "2016-11-10" })]).upcoming).toEqual([]);
	});

	it("orders the countdown by how soon", () => {
		const result = home([
			entry({ title: "Later", releaseDate: "2026-12-01" }),
			entry({ title: "Sooner", releaseDate: "2026-09-01" }),
		]);
		expect(result.upcoming.map((at) => at.entry.title)).toEqual([
			"Sooner",
			"Later",
		]);
	});

	// 8 out of 10 is not better than 5 out of 5, and a shelf mixing films and
	// books has to be able to tell.
	it("ranks your best across scales, not across raw numbers", () => {
		const scaled = {
			...config,
			ratingScale: 10,
			ratingScales: { ...config.ratingScales, book: 5 },
		};
		const entries = [
			entry({ title: "Film", kind: "movie", rating: 8 }),
			entry({ title: "Book", kind: "book", rating: 5 }),
		];
		const result = buildHome(
			scaled,
			entries,
			buildTaste(scaled, entries, NOW),
			NOW,
		);
		expect(result.best[0]?.title).toBe("Book");
	});

	it("counts every finish this year, including second times round", () => {
		const result = home([
			entry({
				status: "Watched",
				finished: "2026-03-01",
				history: ["2019-01-01", "2026-01-01"],
			}),
		]);
		expect(result.summary.finishedThisYear).toBe(2);
	});

	it("says what the library is mostly made of", () => {
		const result = home([
			entry({ kind: "book" }),
			entry({ kind: "book" }),
			entry({ kind: "movie" }),
		]);
		expect(result.summary.dominant).toBe("book");
		expect(result.summary.total).toBe(3);
	});

	it("comes back empty-handed rather than broken", () => {
		const result = home([]);
		expect(result.continuing).toEqual([]);
		expect(result.summary.total).toBe(0);
		expect(result.summary.averageFraction).toBeNull();
		expect(result.topGenres).toEqual([]);
	});
});
