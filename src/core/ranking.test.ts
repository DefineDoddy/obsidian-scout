import { describe, expect, it } from "vitest";
import { rankResults, scoreResults, titleScore } from "./ranking";
import type { MediaItem, MediaKind } from "./types";

function item(
	title: string,
	overrides: Partial<MediaItem> & { providerId?: string } = {},
): MediaItem {
	const { providerId = "tmdb", ...rest } = overrides;
	return {
		ref: {
			providerId,
			kind: (rest.ref?.kind ?? "movie") as MediaKind,
			id: title,
		},
		title,
		tags: [],
		people: [],
		extra: {},
		...rest,
	};
}

const titlesOf = (items: MediaItem[]) => items.map((i) => i.title);

describe("titleScore", () => {
	it("treats case, accents, and punctuation as noise", () => {
		expect(titleScore("wall-e", "WALL·E")).toBe(1);
		expect(titleScore("amelie", "Amélie")).toBe(1);
	});

	it("ranks exact above prefix above word match above partial", () => {
		const exact = titleScore("good boy", "Good Boy");
		const prefix = titleScore("good boy", "Good Boy Returns");
		const contains = titleScore("good boy", "A Very Good Boy");
		const partial = titleScore("good boy", "Good Will Hunting");

		expect(exact).toBeGreaterThan(prefix);
		expect(prefix).toBeGreaterThan(contains);
		expect(contains).toBeGreaterThan(partial);
		expect(partial).toBeGreaterThan(0);
	});

	it("scores an unrelated title at zero", () => {
		expect(titleScore("good boy", "Casablanca")).toBe(0);
	});
});

describe("rankResults", () => {
	it("puts the exact title first even when a partial match is more popular", () => {
		const ranked = rankResults(
			[
				item("Good Boys", { popularity: 900, rating: 6.5, ratingCount: 4000 }),
				item("Good Boy", { popularity: 40, rating: 7.1, ratingCount: 300 }),
			],
			"good boy",
		);
		expect(titlesOf(ranked)[0]).toBe("Good Boy");
	});

	it("breaks a tie between equal titles on popularity", () => {
		const ranked = rankResults(
			[
				item("Good Boy", { ref: { providerId: "tmdb", kind: "movie", id: "a" }, popularity: 12 }),
				item("Good Boy", { ref: { providerId: "tmdb", kind: "tv", id: "b" }, popularity: 800 }),
			],
			"good boy",
		);
		expect(ranked[0]?.ref.kind).toBe("tv");
	});

	it("normalizes popularity per provider so one source cannot dominate", () => {
		// Open Library counts ratings in the thousands, TMDB uses a small float.
		const ranked = rankResults(
			[
				item("Dune", { providerId: "tmdb", popularity: 55 }),
				item("Dune: A Study Guide", {
					providerId: "openlibrary",
					popularity: 9000,
				}),
			],
			"dune",
		);
		expect(titlesOf(ranked)[0]).toBe("Dune");
	});

	it("drops results whose title has nothing to do with the query", () => {
		const many = [
			item("Good Boy"),
			item("Good Boys"),
			item("Good Boy Returns"),
			item("A Very Good Boy"),
			item("Good Boy 2"),
			item("Casablanca"),
		];
		expect(titlesOf(rankResults(many, "good boy"))).not.toContain("Casablanca");
	});

	it("keeps the top results even when everything scores poorly", () => {
		const ranked = rankResults([item("Casablanca"), item("Vertigo")], "zzzz");
		expect(ranked).toHaveLength(2);
	});

	it("weights a high rating by how many people voted", () => {
		const [confident, unproven] = scoreResults(
			[
				item("A", { rating: 8, ratingCount: 5000 }),
				item("B", { rating: 10, ratingCount: 1 }),
			],
			"a",
		);
		expect(confident!.parts.rating).toBeGreaterThan(unproven!.parts.rating);
	});

	it("lists a series in release order rather than by popularity", () => {
		const ranked = rankResults(
			[
				item("Harry Potter and the Goblet of Fire", {
					releaseDate: "2005-11-18",
					popularity: 90,
				}),
				item("Harry Potter and the Philosopher's Stone", {
					releaseDate: "2001-11-16",
					popularity: 30,
				}),
				item("Harry Potter and the Chamber of Secrets", {
					releaseDate: "2002-11-15",
					popularity: 200,
				}),
			],
			"harry potter",
		);
		expect(titlesOf(ranked)).toEqual([
			"Harry Potter and the Philosopher's Stone",
			"Harry Potter and the Chamber of Secrets",
			"Harry Potter and the Goblet of Fire",
		]);
	});

	it("orders same-year installments by their stated number", () => {
		const ranked = rankResults(
			[
				item("Series X Part 3", { releaseDate: "2020-01-01" }),
				item("Series X Part 1", { releaseDate: "2020-01-01" }),
				item("Series X Part 2", { releaseDate: "2020-01-01" }),
			],
			"series x",
		);
		expect(titlesOf(ranked)).toEqual([
			"Series X Part 1",
			"Series X Part 2",
			"Series X Part 3",
		]);
	});

	const potterSeries = (bareTitlePopularity: number) => [
		item("Harry Potter and the Goblet of Fire", {
			releaseDate: "2005-11-18",
			popularity: 400,
		}),
		item("Harry Potter", {
			releaseDate: "2010-01-01",
			popularity: bareTitlePopularity,
		}),
		item("Harry Potter and the Philosopher's Stone", {
			releaseDate: "2001-11-16",
			popularity: 500,
		}),
		item("Harry Potter and the Chamber of Secrets", {
			releaseDate: "2002-11-15",
			popularity: 450,
		}),
	];

	it("keeps a credible exact title above the series it names", () => {
		const ranked = rankResults(potterSeries(300), "harry potter");
		expect(titlesOf(ranked)[0]).toBe("Harry Potter");
	});

	it("does not let an obscure exact title jump a popular series", () => {
		const ranked = rankResults(potterSeries(1), "harry potter");
		expect(titlesOf(ranked)).toEqual([
			"Harry Potter and the Philosopher's Stone",
			"Harry Potter and the Chamber of Secrets",
			"Harry Potter and the Goblet of Fire",
			"Harry Potter",
		]);
	});

	it("does not reorder two lookalikes into a false series", () => {
		const ranked = rankResults(
			[
				item("Dune Part Two", { releaseDate: "2024-02-27", popularity: 900 }),
				item("Dune Messiah", { releaseDate: "1969-01-01", popularity: 5 }),
			],
			"dune",
		);
		expect(titlesOf(ranked)[0]).toBe("Dune Part Two");
	});

	it("does not interleave books and films into one chronology", () => {
		const ranked = rankResults(
			[
				item("Saga One", { ref: { providerId: "tmdb", kind: "movie", id: "1" }, releaseDate: "2005-01-01" }),
				item("Saga Two", { ref: { providerId: "tmdb", kind: "movie", id: "2" }, releaseDate: "2006-01-01" }),
				item("Saga Three", { ref: { providerId: "tmdb", kind: "movie", id: "3" }, releaseDate: "2007-01-01" }),
				item("Saga Book", {
					providerId: "openlibrary",
					ref: { providerId: "openlibrary", kind: "book", id: "b" },
					releaseDate: "1990-01-01",
				}),
			],
			"saga",
		);
		// The lone book is not part of a three-strong run, so it is left alone
		// rather than pulled to the front of the films by its earlier date.
		expect(titlesOf(ranked).slice(0, 3)).toEqual([
			"Saga One",
			"Saga Two",
			"Saga Three",
		]);
	});

	it("keeps spin-offs out of the middle of a series", () => {
		const ranked = rankResults(
			[
				item("Harry Potter and the Philosopher's Stone", {
					releaseDate: "2001-11-16",
					ratingCount: 28000,
				}),
				// A making-of that would otherwise date-sort between the films.
				item("Harry Potter: A History of Magic", {
					releaseDate: "2017-09-28",
					ratingCount: 40,
				}),
				item("Harry Potter and the Chamber of Secrets", {
					releaseDate: "2002-11-15",
					ratingCount: 24000,
				}),
				item("Harry Potter and the Deathly Hallows: Part 2", {
					releaseDate: "2011-07-12",
					ratingCount: 20000,
				}),
			],
			"harry potter",
		);
		expect(titlesOf(ranked)).toEqual([
			"Harry Potter and the Philosopher's Stone",
			"Harry Potter and the Chamber of Secrets",
			"Harry Potter and the Deathly Hallows: Part 2",
			"Harry Potter: A History of Magic",
		]);
	});

	it("lifts the films and the books above unrelated better-scoring results", () => {
		const film = (title: string, date: string) =>
			item(title, {
				ref: { providerId: "tmdb", kind: "movie", id: title },
				releaseDate: date,
				ratingCount: 20000,
			});
		const book = (title: string, date: string) =>
			item(title, {
				providerId: "openlibrary",
				ref: { providerId: "openlibrary", kind: "book", id: title },
				releaseDate: date,
				ratingCount: 9000,
			});

		const ranked = rankResults(
			[
				// Scores well on its own: short title, high rating, full metadata.
				item("Harry Potter Guide", {
					ratingCount: 30000,
					rating: 9.8,
					description: "A guide",
					thumbnailUrl: "https://example.com/g.jpg",
					ref: { providerId: "tmdb", kind: "tv", id: "guide" },
				}),
				film("Harry Potter and the Goblet of Fire", "2005-11-18"),
				book("Harry Potter and the Chamber of Secrets", "1998-07-02"),
				film("Harry Potter and the Philosopher's Stone", "2001-11-16"),
				book("Harry Potter and the Philosopher's Stone", "1997-06-26"),
				film("Harry Potter and the Chamber of Secrets", "2002-11-15"),
				book("Harry Potter and the Prisoner of Azkaban", "1999-07-08"),
			],
			"harry potter",
		);

		// Both series come first, each an unbroken chronological run, with the
		// loose result pushed below them. Which medium leads is not something
		// the ranking should claim to know.
		const kinds = ranked.slice(0, 6).map((i) => i.ref.kind);
		expect(new Set(kinds)).toEqual(new Set(["movie", "book"]));
		expect(kinds[0]).toBe(kinds[1]);
		expect(kinds[1]).toBe(kinds[2]);
		expect(kinds[3]).toBe(kinds[4]);
		expect(kinds[4]).toBe(kinds[5]);
		expect(ranked[6]?.title).toBe("Harry Potter Guide");

		const books = ranked.filter((i) => i.ref.kind === "book");
		expect(titlesOf(books)).toEqual([
			"Harry Potter and the Philosopher's Stone",
			"Harry Potter and the Chamber of Secrets",
			"Harry Potter and the Prisoner of Azkaban",
		]);
	});

	it("keeps companion titles out of a series with no rating counts", () => {
		// Open Library rarely reports ratings_count, so the naming pattern is
		// the only thing separating the novels from the tie-ins.
		const book = (title: string, date: string) =>
			item(title, {
				providerId: "openlibrary",
				ref: { providerId: "openlibrary", kind: "book", id: title },
				releaseDate: date,
			});

		const ranked = rankResults(
			[
				book("Harry Potter and the Goblet of Fire", "2000-07-08"),
				book("Harry Potter: A History of Magic", "1999-05-01"),
				book("Harry Potter and the Philosopher's Stone", "1997-06-26"),
				book("Harry Potter Cookbook", "1998-01-01"),
				book("Harry Potter and the Chamber of Secrets", "1998-07-02"),
				book("Harry Potter and the Prisoner of Azkaban", "1999-07-08"),
			],
			"harry potter",
		);
		expect(titlesOf(ranked).slice(0, 4)).toEqual([
			"Harry Potter and the Philosopher's Stone",
			"Harry Potter and the Chamber of Secrets",
			"Harry Potter and the Prisoner of Azkaban",
			"Harry Potter and the Goblet of Fire",
		]);
	});

	it("prefers the pattern covering most of a series over the longest one", () => {
		// "and the deathly hallows" is shared by two entries and "and the" by
		// all five; singling out the longer one would discard the series.
		const film = (title: string, date: string) =>
			item(title, { releaseDate: date });

		const ranked = rankResults(
			[
				film("Harry Potter and the Deathly Hallows: Part 1", "2010-11-19"),
				film("Harry Potter and the Deathly Hallows: Part 2", "2011-07-15"),
				film("Harry Potter and the Philosopher's Stone", "2001-11-16"),
				film("Harry Potter and the Chamber of Secrets", "2002-11-15"),
				film("Harry Potter and the Goblet of Fire", "2005-11-18"),
			],
			"harry potter",
		);
		expect(ranked).toHaveLength(5);
		expect(titlesOf(ranked)[0]).toBe(
			"Harry Potter and the Philosopher's Stone",
		);
		expect(titlesOf(ranked)[4]).toBe(
			"Harry Potter and the Deathly Hallows: Part 2",
		);
	});

	it("does not let a weak run displace the popular thing the query named", () => {
		const guide = (title: string, date: string) =>
			item(title, {
				providerId: "openlibrary",
				ref: { providerId: "openlibrary", kind: "book", id: title },
				releaseDate: date,
				ratingCount: 3,
			});

		const ranked = rankResults(
			[
				guide("Dune Study Guide", "1990-01-01"),
				guide("Dune Companion", "1991-01-01"),
				guide("Dune Annotated", "1992-01-01"),
				item("Dune Part Two", {
					releaseDate: "2024-02-27",
					ratingCount: 12000,
					rating: 8.2,
				}),
			],
			"dune",
		);
		expect(titlesOf(ranked)[0]).toBe("Dune Part Two");
	});

	it("prefers all-time votes over a decaying trend score", () => {
		// TMDB popularity spikes for anything newly released; vote count does not.
		const ranked = rankResults(
			[
				item("Good Boy: The Cash-In", { popularity: 800, ratingCount: 12 }),
				item("Good Boy: The Classic", { popularity: 9, ratingCount: 40000 }),
			],
			"good boy",
		);
		expect(titlesOf(ranked)[0]).toBe("Good Boy: The Classic");
	});

	it("does not count a placeholder image as artwork", () => {
		const [withArt, placeholder] = scoreResults(
			[
				item("A", { thumbnailUrl: "https://example.com/a.jpg" }),
				item("B", { thumbnailUrl: "data:image/svg+xml;utf8,%3Csvg" }),
			],
			"a",
		);
		expect(withArt!.parts.completeness).toBeGreaterThan(
			placeholder!.parts.completeness,
		);
	});
});
