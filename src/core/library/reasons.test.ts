import { describe, expect, it } from "vitest";
import { rankReasons, reasonForNamespace, type Reason } from "./reasons";

const reason = (over: Partial<Reason> = {}): Reason => ({
	kind: "genre",
	label: "Drama",
	strength: 0.5,
	...over,
});

describe("rankReasons", () => {
	/**
	 * That something completes a series you are most of the way through is
	 * worth saying. That it is a Drama is worth saying only when there is
	 * nothing better, because almost everything is.
	 */
	it("says the more telling thing first", () => {
		const ranked = rankReasons(
			[
				reason({ kind: "genre", label: "Drama", strength: 0.9 }),
				reason({ kind: "series", label: "Part of Alien", strength: 0.3 }),
			],
			2,
		);
		expect(ranked[0]?.label).toBe("Part of Alien");
	});

	it("breaks a tie on how strongly it was felt", () => {
		const ranked = rankReasons(
			[
				reason({ label: "Weak", strength: 0.2 }),
				reason({ kind: "keyword", label: "Strong", strength: 0.9 }),
			],
			2,
		);
		expect(ranked[0]?.label).toBe("Strong");
	});

	// Three genre chips is not an explanation, it is a tag cloud — and matching
	// three genres you like has told you one thing, not three.
	it("never gives two reasons of the same sort", () => {
		const ranked = rankReasons(
			[
				reason({ label: "Drama", strength: 0.9 }),
				reason({ label: "Thriller", strength: 0.8 }),
				reason({ kind: "director", label: "Someone", strength: 0.1 }),
			],
			3,
		);
		expect(ranked).toHaveLength(2);
		expect(ranked.map((one) => one.label)).toEqual(["Someone", "Drama"]);
	});

	it("never returns more than it was asked for", () => {
		const many = Array.from({ length: 6 }, (_, at) =>
			reason({ kind: at % 2 ? "keyword" : "person", label: `R${at}` }),
		);
		expect(rankReasons(many, 2)).toHaveLength(2);
	});

	it("has nothing to say about nothing", () => {
		expect(rankReasons([], 2)).toEqual([]);
	});
});

describe("reasonForNamespace", () => {
	it("turns the traits worth mentioning into reasons", () => {
		expect(reasonForNamespace("director")).toBe("director");
		expect(reasonForNamespace("keyword")).toBe("keyword");
	});

	/**
	 * These earn their place in the score and none at all in the explanation.
	 * "It is from the 2010s" is not something anybody wants read back to them.
	 */
	it("stays quiet about the ones nobody wants read back to them", () => {
		expect(reasonForNamespace("decade")).toBeUndefined();
		expect(reasonForNamespace("runtime")).toBeUndefined();
		expect(reasonForNamespace("language")).toBeUndefined();
	});
});
