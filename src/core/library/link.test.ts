import { describe, expect, it } from "vitest";
import type { MediaItem, MediaKind } from "../types";
import type { LibraryEntry } from "./entry";
import { certainMatch } from "./link";

/**
 * The rule that decides whether a note can be linked to a source without a
 * human looking at it. Everything else in `link.ts` is network and file
 * writing; this is the part that can be wrong quietly.
 */

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
	const title = overrides.title ?? "Arrival";
	return {
		path: `Media/${title}.md`,
		basename: title,
		title,
		kind: "movie" as MediaKind,
		tags: [],
		people: [],
		authored: [],
		favorite: false,
		history: [],
		episodeLog: {},
		collections: [],
		created: 0,
		modified: 0,
		frontmatter: {},
		...overrides,
	};
}

function item(
	id: string,
	title: string,
	overrides: Partial<MediaItem> = {},
): MediaItem {
	return {
		ref: { providerId: "tmdb", kind: "movie", id },
		title,
		tags: [],
		people: [],
		extra: {},
		...overrides,
	};
}

describe("certainMatch", () => {
	it("takes the only item of that name", () => {
		const found = certainMatch(entry(), [
			item("1", "Arrival"),
			item("2", "Arrival of the Fittest"),
		]);
		expect(found?.ref.id).toBe("1");
	});

	it("ignores an exact title of the wrong kind", () => {
		const found = certainMatch(entry({ kind: "book" }), [
			item("1", "Arrival"),
		]);
		expect(found).toBeUndefined();
	});

	it("matches on the filename when the title property says otherwise", () => {
		const found = certainMatch(
			entry({ basename: "Arrival", title: "Arrival (2016)" }),
			[item("1", "Arrival")],
		);
		expect(found?.ref.id).toBe("1");
	});

	it("ignores punctuation, case, and accents", () => {
		const found = certainMatch(entry({ title: "amelie" }), [
			item("1", "Amélie"),
		]);
		expect(found?.ref.id).toBe("1");
	});

	it("separates same-named works by the year the note records", () => {
		const candidates = [
			item("old", "Dune", { year: 1984 }),
			item("new", "Dune", { year: 2021 }),
		];
		expect(certainMatch(entry({ title: "Dune", year: 2021 }), candidates)?.ref.id).toBe(
			"new",
		);
		expect(certainMatch(entry({ title: "Dune", year: 1984 }), candidates)?.ref.id).toBe(
			"old",
		);
	});

	it("allows a year to be a day either side of new year", () => {
		const found = certainMatch(entry({ title: "Dune", year: 2020 }), [
			item("old", "Dune", { year: 1984 }),
			item("new", "Dune", { year: 2021 }),
		]);
		expect(found?.ref.id).toBe("new");
	});

	it("refuses when the note's year matches nothing of that name", () => {
		const found = certainMatch(entry({ title: "Dune", year: 2000 }), [
			item("old", "Dune", { year: 1984 }),
			item("new", "Dune", { year: 2021 }),
		]);
		expect(found).toBeUndefined();
	});

	it("refuses two comparably known works when the note has no year", () => {
		const found = certainMatch(entry({ title: "Dune" }), [
			item("old", "Dune", { year: 1984, ratingCount: 4000 }),
			item("new", "Dune", { year: 2021, ratingCount: 11000 }),
		]);
		expect(found).toBeUndefined();
	});

	it("takes a runaway favourite over an obscurity of the same name", () => {
		const found = certainMatch(entry({ title: "Arrival" }), [
			item("famous", "Arrival", { year: 2016, ratingCount: 8000 }),
			item("obscure", "Arrival", { year: 1996, ratingCount: 12 }),
		]);
		expect(found?.ref.id).toBe("famous");
	});

	it("judges each source's answer on its own", () => {
		// Ids only mean anything inside the source that issued them, which is
		// why this is asked one source at a time: two of them answering with
		// their own id for the same book is agreement, not a conflict.
		const book = item("OL45883W", "Dune", {
			ref: { providerId: "openlibrary", kind: "book", id: "OL45883W" },
			year: 1965,
		});
		const found = certainMatch(
			entry({ title: "Dune", kind: "book", year: 1965 }),
			[book],
		);
		expect(found?.ref.providerId).toBe("openlibrary");
	});

	it("finds nothing in an empty or unrelated response", () => {
		expect(certainMatch(entry(), [])).toBeUndefined();
		expect(certainMatch(entry(), [item("1", "Departure")])).toBeUndefined();
	});
});
