import { describe, expect, it } from "vitest";
import { rankSuggestions } from "./Suggest";

const GENRES = [
	"Action",
	"Action & Adventure",
	"Animation",
	"Comedy",
	"Crime",
	"Documentary",
	"Drama",
	"Science Fiction",
	"Sci-Fi & Fantasy",
];

describe("rankSuggestions", () => {
	it("shows the head of the list before anything is typed", () => {
		expect(rankSuggestions(GENRES, "", 3)).toEqual([
			"Action",
			"Action & Adventure",
			"Animation",
		]);
		expect(rankSuggestions(GENRES, "   ", 3)).toHaveLength(3);
	});

	// A vault with two hundred genres is the case the control exists for; the
	// cap is what keeps the popup from being as unreachable as the one it
	// replaced.
	it("never returns more than it was asked for", () => {
		const many = Array.from({ length: 500 }, (_, i) => `Genre ${i}`);
		expect(rankSuggestions(many, "genre", 20)).toHaveLength(20);
		expect(rankSuggestions(many, "", 20)).toHaveLength(20);
	});

	it("matches anywhere in the word, case regardless", () => {
		expect(rankSuggestions(GENRES, "MEN", 10)).toEqual(["Documentary"]);
		// Both start with it, so they keep the order they came in.
		expect(rankSuggestions(GENRES, "sci", 10)).toEqual([
			"Science Fiction",
			"Sci-Fi & Fantasy",
		]);
	});

	it("puts what starts with the query above what merely contains it", () => {
		// "Crime" contains "rim"; nothing starts with it, so order is source
		// order — but "Drama" beats "Documentary" for "dra" by starting with it.
		expect(rankSuggestions(GENRES, "dra", 10)).toEqual(["Drama"]);
		expect(rankSuggestions(["Undrafted", "Drama"], "dra", 10)).toEqual([
			"Drama",
			"Undrafted",
		]);
	});

	it("looks past accents, so a name can be typed plainly", () => {
		const people = ["Alejandro González Iñárritu", "Amélie Poulain"];
		expect(rankSuggestions(people, "inarritu", 10)).toEqual([people[0]]);
		expect(rankSuggestions(people, "amelie", 10)).toEqual([people[1]]);
	});

	it("says nothing rather than everything when nothing matches", () => {
		expect(rankSuggestions(GENRES, "westerns", 10)).toEqual([]);
	});
});
