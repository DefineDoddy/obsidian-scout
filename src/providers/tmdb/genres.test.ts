import { describe, expect, it } from "vitest";
import { genreIds, genreNames } from "./genres";

describe("genreNames", () => {
	/**
	 * Why this file exists. TMDB names genres only on the per-title detail
	 * endpoint; every list endpoint — search, recommendations, discover —
	 * returns bare ids, so without this every suggestion arrived with no genres
	 * and the half of the recommender that ranks on genre ranked on nothing.
	 */
	it("names the ids a list endpoint returns", () => {
		expect(genreNames([878, 18])).toEqual(["Science Fiction", "Drama"]);
	});

	it("skips an id it does not know rather than inventing one", () => {
		expect(genreNames([18, 999_999])).toEqual(["Drama"]);
	});

	it("says nothing about a record that carried no ids", () => {
		expect(genreNames(undefined)).toEqual([]);
	});
});

describe("genreIds", () => {
	it("finds the id for a name the catalogue uses", () => {
		expect(genreIds(["Science Fiction"], "movie")).toEqual([878]);
	});

	/**
	 * The two catalogues genuinely disagree: films have Science Fiction and
	 * Fantasy separately, television has one "Sci-Fi & Fantasy", and each
	 * endpoint rejects the other's id. Somebody whose taste was learned from a
	 * shelf of TV would otherwise match nothing at all when asking for films.
	 */
	it("translates a television genre into its film equivalents", () => {
		expect(genreIds(["Sci-Fi & Fantasy"], "movie")).toEqual([878, 14]);
	});

	it("translates a film genre into its television equivalent", () => {
		expect(genreIds(["Science Fiction"], "tv")).toEqual([10765]);
	});

	it("leaves alone a genre both catalogues agree on", () => {
		expect(genreIds(["Animation"], "movie")).toEqual([16]);
		expect(genreIds(["Animation"], "tv")).toEqual([16]);
	});

	it("is not fussy about case or spacing", () => {
		expect(genreIds([" drama "], "movie")).toEqual([18]);
	});

	it("says nothing rather than guessing at a name it does not know", () => {
		expect(genreIds(["Cyberpunk"], "movie")).toEqual([]);
	});

	it("returns each id once, however many names lead to it", () => {
		expect(genreIds(["Science Fiction", "Fantasy"], "tv")).toEqual([10765]);
	});
});
