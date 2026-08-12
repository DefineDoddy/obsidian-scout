import { describe, expect, it } from "vitest";
import { entry, item, verdict } from "../../test/fixtures";
import {
	parseTrait,
	runtimeBand,
	traitKey,
	traitsOfEntry,
	traitsOfItem,
	traitsOfRecord,
} from "./traits";

const keysOf = (traits: { key: string }[]) => traits.map((one) => one.key);

describe("traitKey", () => {
	it("folds one genre spelled two ways into one trait", () => {
		const [a] = traitsOfEntry(entry({ tags: ["Sci-Fi"] }));
		const [b] = traitsOfEntry(entry({ tags: ["sci-fi "] }));
		expect(a?.key).toBe(b?.key);
		// The fold is for matching; what a person is shown keeps its spelling.
		expect(a?.label).toBe("Sci-Fi");
	});

	it("reads a key back into the two halves it was made of", () => {
		expect(parseTrait(traitKey("director", "Denis Villeneuve"))).toEqual({
			ns: "director",
			value: "denis villeneuve",
		});
	});

	// A value with a colon in it must not become a namespace of its own.
	it("splits on the first colon only", () => {
		expect(parseTrait(traitKey("series", "tmdb:8091"))?.value).toBe("tmdb:8091");
	});
});

describe("traitsOfEntry", () => {
	/**
	 * The whole reason `authored` exists. Default templates write a `director`
	 * and nothing else, so this is the one credit most libraries can produce
	 * with no network at all — and it is worth far more than a face in a cast
	 * list, which is what it used to be indistinguishable from.
	 */
	it("keeps whoever made a thing apart from whoever is in it", () => {
		const keys = keysOf(
			traitsOfEntry(
				entry({
					people: ["Denis Villeneuve", "Amy Adams"],
					authored: ["Denis Villeneuve"],
				}),
			),
		);
		expect(keys).toContain(traitKey("director", "Denis Villeneuve"));
		expect(keys).toContain(traitKey("person", "Amy Adams"));
		expect(keys).not.toContain(traitKey("person", "Denis Villeneuve"));
	});

	it("puts a year in its decade", () => {
		expect(keysOf(traitsOfEntry(entry({ year: 2016 })))).toContain(
			traitKey("decade", "2010s"),
		);
	});

	// A cast list of twenty is mostly people you never noticed were there.
	it("stops after the first few names", () => {
		const crowd = Array.from({ length: 9 }, (_, at) => `Person ${at}`);
		const people = keysOf(traitsOfEntry(entry({ people: crowd }))).filter(
			(key) => key.startsWith("person:"),
		);
		expect(people).toHaveLength(4);
	});

	/**
	 * A smart collection is a rule over fields the model already reads, so
	 * counting membership would count the same evidence twice. A collection you
	 * filled by hand is a judgement and nothing else knows about it.
	 */
	it("learns from a shelf you filled by hand and not from a rule", () => {
		const keys = keysOf(
			traitsOfEntry(entry({ collections: ["Comfort", "Recently rated"] }), {
				manualCollections: new Set(["comfort"]),
			}),
		);
		expect(keys).toContain(traitKey("collection", "Comfort"));
		expect(keys).not.toContain(traitKey("collection", "Recently rated"));
	});

	// Rebuilt on every render; the index only hands out a new entry object when
	// the note actually changed, so identity is a sound thing to cache against.
	it("hands back the same traits for a note that has not changed", () => {
		const note = entry({ tags: ["Drama"], people: ["Someone"] });
		expect(traitsOfEntry(note)).toBe(traitsOfEntry(note));
	});

	/**
	 * The whole reason enrichment exists. A note holds a genre and a name; the
	 * cache holds what the thing is actually about, and "you keep going for
	 * time loops" is not a sentence eighteen genres can produce.
	 */
	it("knows what a thing is about once something has read up on it", () => {
		const note = entry({
			tags: ["Science Fiction"],
			ref: { providerId: "tmdb", kind: "movie", id: "1" },
		});
		const bare = keysOf(traitsOfEntry(note));
		const read = keysOf(
			traitsOfEntry(note, {
				enrichment: {
					"tmdb:1": {
						v: 1,
						at: 0,
						keywords: [{ name: "time loop", id: "4565" }],
						people: [],
						directors: [{ name: "Denis Villeneuve" }],
						studios: ["A24"],
					},
				},
			}),
		);

		expect(bare).not.toContain(traitKey("keyword", "time loop"));
		expect(read).toContain(traitKey("keyword", "time loop"));
		expect(read).toContain(traitKey("director", "Denis Villeneuve"));
		expect(read).toContain(traitKey("studio", "A24"));
		// And it still knows everything the note itself said.
		expect(read).toContain(traitKey("genre", "Science Fiction"));
	});

	it("is unbothered by a cache that has nothing about this one", () => {
		const note = entry({
			tags: ["Drama"],
			ref: { providerId: "tmdb", kind: "movie", id: "1" },
		});
		expect(keysOf(traitsOfEntry(note, { enrichment: {} }))).toContain(
			traitKey("genre", "Drama"),
		);
	});
});

describe("traitsOfItem", () => {
	it("reads the director a source names even when a note never would", () => {
		const keys = keysOf(
			traitsOfItem(
				item({
					people: ["Denis Villeneuve", "Amy Adams"],
					extra: { directors: ["Denis Villeneuve"] },
				}),
			),
		);
		expect(keys).toContain(traitKey("director", "Denis Villeneuve"));
		expect(keys).not.toContain(traitKey("person", "Denis Villeneuve"));
	});

	// Two catalogues spell "The Alien Collection" differently and mean one shelf.
	it("takes a series by its id rather than by its name", () => {
		const keys = keysOf(
			traitsOfItem(
				item({ extra: { series: "Alien Collection", series_id: "8091" } }),
			),
		);
		expect(keys).toContain(traitKey("series", "tmdb:8091"));
	});

	it("still reads the series off a record written before the rename", () => {
		const keys = keysOf(
			traitsOfItem(
				item({ extra: { collection: "Alien Collection", collection_id: "8091" } }),
			),
		);
		expect(keys).toContain(traitKey("series", "tmdb:8091"));
	});

	it("says nothing about a series for something that is not in one", () => {
		const keys = keysOf(traitsOfItem(item({ extra: {} })));
		expect(keys.some((key) => key.startsWith("series:"))).toBe(false);
	});
});

describe("traitsOfRecord", () => {
	/**
	 * A thumbs-up records its traits at the moment it is cast — and this function
	 * ignored them, re-deriving a genre list from `tags` instead. So a vote on a
	 * film carrying a director, a studio, a series and eleven keywords taught the
	 * model four genres and three names, and the one button whose entire job is to
	 * correct the model was the signal read most poorly.
	 */
	it("reads the traits the vote was recorded with", () => {
		const keys = keysOf(
			traitsOfRecord(
				verdict({
					tags: ["Thriller"],
					traits: [
						traitKey("keyword", "time loop"),
						traitKey("director", "Denis Villeneuve"),
					],
				}),
			),
		);
		expect(keys).toContain(traitKey("keyword", "time loop"));
		expect(keys).toContain(traitKey("director", "Denis Villeneuve"));
		expect(keys).toContain(traitKey("genre", "Thriller"));
	});

	// Records written before traits existed still have to say something.
	it("falls back to the tags and names on an older record", () => {
		const keys = keysOf(
			traitsOfRecord(verdict({ tags: ["Horror"], people: ["Someone"] })),
		);
		expect(keys).toContain(traitKey("genre", "Horror"));
		expect(keys).toContain(traitKey("person", "Someone"));
	});
});

describe("runtimeBand", () => {
	// Ninety-four minutes and ninety-six are the same fact about an evening.
	it("bands a runtime rather than believing the minute", () => {
		expect(runtimeBand(45)).toBe("short");
		expect(runtimeBand(94)).toBe("standard");
		expect(runtimeBand(96)).toBe(runtimeBand(94));
		expect(runtimeBand(150)).toBe("long");
		expect(runtimeBand(220)).toBe("epic");
	});

	/**
	 * A book's length arrives as pages, and four hundred of them is an ordinary
	 * novel where four hundred minutes would be an ordeal. One set of
	 * thresholds would have filed every book ever written under "epic".
	 */
	it("counts a book's pages on the scale pages are on", () => {
		expect(runtimeBand(400, "book")).toBe("standard");
		expect(runtimeBand(400)).toBe("epic");
		expect(runtimeBand(90, "book")).toBe("short");
		expect(runtimeBand(900, "book")).toBe("epic");
	});

	it("has nothing to say when the source did not", () => {
		expect(runtimeBand(undefined)).toBeUndefined();
		expect(runtimeBand(0)).toBeUndefined();
	});
});
