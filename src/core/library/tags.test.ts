import { describe, expect, it } from "vitest";
import { needsTagSafeNames, tagSafe, tagSafeList } from "./tags";

describe("tagSafe", () => {
	// The one that started it: TMDB's own name for the genre.
	it("keeps the word an ampersand was standing for", () => {
		expect(tagSafe("Sci-Fi & Fantasy")).toBe("Sci-Fi-and-Fantasy");
		expect(tagSafe("Action & Adventure")).toBe("Action-and-Adventure");
	});

	it("joins words with a hyphen and leaves letters alone", () => {
		expect(tagSafe("Science Fiction")).toBe("Science-Fiction");
		expect(tagSafe("Drama")).toBe("Drama");
	});

	it("keeps the characters a tag is allowed", () => {
		expect(tagSafe("genre/horror")).toBe("genre/horror");
		expect(tagSafe("slice_of_life")).toBe("slice_of_life");
	});

	it("does not leave a tag that is only digits", () => {
		expect(tagSafe("2001")).toBe("_2001");
	});

	it("comes back empty when there was nothing usable in it", () => {
		expect(tagSafe("  ")).toBe("");
		expect(tagSafe("!!!")).toBe("");
	});

	it("handles a language Latin letters do not cover", () => {
		expect(tagSafe("恋愛 コメディ")).toBe("恋愛-コメディ");
	});
});

describe("tagSafeList", () => {
	it("drops what sanitized away and what repeated", () => {
		expect(tagSafeList(["Drama", "!!!", "drama", "Sci-Fi & Fantasy"])).toEqual([
			"Drama",
			"Sci-Fi-and-Fantasy",
		]);
	});
});

describe("needsTagSafeNames", () => {
	it("is true for the properties Obsidian always reads as tags", () => {
		expect(needsTagSafeNames("tags")).toBe(true);
		expect(needsTagSafeNames("Tag")).toBe(true);
	});

	// The default mapping. Left alone, the genre keeps its real name.
	it("is false for an ordinary list property", () => {
		expect(needsTagSafeNames("genres")).toBe(false);
	});

	it("follows the vault when the vault has typed the property as tags", () => {
		const typed = (name: string) => (name === "genres" ? "tags" : "multitext");
		expect(needsTagSafeNames("genres", typed)).toBe(true);
		expect(needsTagSafeNames("people", typed)).toBe(false);
	});
});
