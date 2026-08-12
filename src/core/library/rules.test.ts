import { describe, expect, it } from "vitest";
import { defaultLibraryConfig } from "./config";
import type { LibraryEntry } from "./entry";
import {
	describeRule,
	emptyRule,
	matchesCondition,
	matchesRule,
	normalizeRule,
	operatorsFor,
	ruleIsEmpty,
	type Condition,
	type RuleGroup,
} from "./rules";

const config = defaultLibraryConfig();
const now = new Date("2026-08-12T12:00:00Z");
const DAY = 86_400_000;

function entry(
	title: string,
	overrides: Partial<LibraryEntry> = {},
): LibraryEntry {
	return {
		path: `Media/${title}.md`,
		basename: title,
		title,
		kind: "movie",
		tags: [],
		people: [],
		authored: [],
		favorite: false,
		history: [],
		episodeLog: {},
		collections: [],
		created: now.getTime(),
		modified: now.getTime(),
		frontmatter: {},
		...overrides,
	};
}

const arrival = entry("Arrival", {
	year: 2016,
	rating: 4.5,
	sourceRating: 7.9,
	status: "Watched",
	tags: ["Drama", "Science Fiction"],
	people: ["Denis Villeneuve"],
	collections: ["Comfort rewatches"],
	favorite: true,
	finished: "2026-07-01",
	created: now.getTime() - 40 * DAY,
	frontmatter: { type: "movie", shelf_of: "the good one", rewatch: true },
});

const dune = entry("Dune", {
	kind: "movie",
	year: 2021,
	tags: ["Science Fiction", "Adventure"],
	status: "To watch",
	created: now.getTime() - 2 * DAY,
});

const condition = (c: Condition) => c;
const match = (entry: LibraryEntry, c: Condition) =>
	matchesCondition(entry, c, config, now);

describe("operatorsFor", () => {
	// An editor that offers "Year contains" is an editor that will be blamed
	// for the empty list it produces.
	it("only offers what the field can answer", () => {
		expect(operatorsFor("year")).toContain("between");
		expect(operatorsFor("year")).not.toContain("contains");
		expect(operatorsFor("genre")).toEqual(["has", "has-not", "set", "unset"]);
		expect(operatorsFor("favorite")).toEqual(["is"]);
		expect(operatorsFor("finished")).toContain("within");
	});
});

describe("matchesCondition", () => {
	it("reads the list fields as lists", () => {
		expect(match(arrival, condition({ field: "genre", op: "has", value: "drama" }))).toBe(true);
		expect(match(arrival, condition({ field: "genre", op: "has", value: "horror" }))).toBe(false);
		expect(match(arrival, condition({ field: "genre", op: "has-not", value: "horror" }))).toBe(true);
	});

	// "Sci-fi, fantasy" in one box is two answers, not a genre nobody has.
	it("takes a comma-separated value as any of", () => {
		expect(
			match(arrival, condition({ field: "genre", op: "has", value: "horror, drama" })),
		).toBe(true);
		expect(
			match(dune, condition({ field: "kind", op: "is", value: "book, movie" })),
		).toBe(true);
	});

	it("compares ratings proportionally, on the note's own scale", () => {
		// 4.5 of 5 against "at least 4 of 5".
		expect(match(arrival, condition({ field: "rating", op: "gte", value: "4" }))).toBe(true);
		expect(match(arrival, condition({ field: "rating", op: "gte", value: "5" }))).toBe(false);
		// An exact edge, which floats would otherwise lose by a fraction.
		expect(
			matchesCondition(
				entry("Edge", { rating: 4 }),
				{ field: "rating", op: "gte", value: "4" },
				config,
				now,
			),
		).toBe(true);
	});

	it("treats a source score of zero as nobody having voted", () => {
		const unvoted = entry("Unreleased", { sourceRating: 0 });
		expect(match(unvoted, condition({ field: "sourceRating", op: "set" }))).toBe(false);
		expect(match(arrival, condition({ field: "sourceRating", op: "gte", value: "7" }))).toBe(true);
	});

	it("understands set and unset for every shape of field", () => {
		expect(match(dune, condition({ field: "rating", op: "unset" }))).toBe(true);
		expect(match(dune, condition({ field: "collection", op: "unset" }))).toBe(true);
		expect(match(arrival, condition({ field: "collection", op: "set" }))).toBe(true);
	});

	it("measures dates against the clock it was given", () => {
		expect(match(dune, condition({ field: "added", op: "within", value: "7" }))).toBe(true);
		expect(match(arrival, condition({ field: "added", op: "within", value: "7" }))).toBe(false);
		expect(
			match(arrival, condition({ field: "finished", op: "after", value: "2026-06-01" })),
		).toBe(true);
		expect(
			match(arrival, condition({ field: "finished", op: "before", value: "2026-06-01" })),
		).toBe(false);
	});

	// A note with no date cannot be within thirty days of anything.
	it("fails a date test rather than passing it when there is no date", () => {
		expect(match(dune, condition({ field: "finished", op: "within", value: "3650" }))).toBe(false);
	});

	it("reads the status tone rather than the word", () => {
		expect(match(arrival, condition({ field: "tone", op: "is", value: "done" }))).toBe(true);
		expect(match(dune, condition({ field: "tone", op: "is", value: "planned" }))).toBe(true);
		expect(match(dune, condition({ field: "tone", op: "is-not", value: "done" }))).toBe(true);
	});

	it("reaches any property the note happens to carry", () => {
		expect(
			match(arrival, {
				field: "property",
				op: "contains",
				key: "shelf_of",
				value: "good",
			}),
		).toBe(true);
		expect(
			match(arrival, { field: "property", op: "set", key: "rewatch" }),
		).toBe(true);
		expect(
			match(arrival, { field: "property", op: "set", key: "nothing_here" }),
		).toBe(false);
	});

	it("says no to a condition with nothing typed in it", () => {
		expect(match(arrival, condition({ field: "genre", op: "has", value: "" }))).toBe(false);
	});
});

describe("matchesRule", () => {
	const scifi: Condition = { field: "genre", op: "has", value: "science fiction" };
	const finished: Condition = { field: "tone", op: "is", value: "done" };

	it("matches everything when it says nothing", () => {
		expect(matchesRule(dune, emptyRule(), config, now)).toBe(true);
		expect(matchesRule(dune, null, config, now)).toBe(true);
	});

	it("ands, ors and nots", () => {
		const all: RuleGroup = { match: "all", conditions: [scifi, finished], groups: [] };
		const any: RuleGroup = { match: "any", conditions: [scifi, finished], groups: [] };
		const none: RuleGroup = { match: "none", conditions: [finished], groups: [] };

		expect(matchesRule(arrival, all, config, now)).toBe(true);
		expect(matchesRule(dune, all, config, now)).toBe(false);
		expect(matchesRule(dune, any, config, now)).toBe(true);
		expect(matchesRule(dune, none, config, now)).toBe(true);
		expect(matchesRule(arrival, none, config, now)).toBe(false);
	});

	// The shape every real filter ends up in: this and that, except the other.
	it("nests a group inside a group", () => {
		const rule: RuleGroup = {
			match: "all",
			conditions: [scifi],
			groups: [
				{
					match: "none",
					conditions: [{ field: "year", op: "lte", value: "2019" }],
					groups: [],
				},
			],
		};
		expect(matchesRule(dune, rule, config, now)).toBe(true);
		expect(matchesRule(arrival, rule, config, now)).toBe(false);
	});

	// An empty nested group would otherwise drag a "none" group to false.
	it("ignores groups with nothing in them", () => {
		const rule: RuleGroup = {
			match: "none",
			conditions: [{ field: "genre", op: "has", value: "horror" }],
			groups: [emptyRule()],
		};
		expect(matchesRule(arrival, rule, config, now)).toBe(true);
	});
});

describe("normalizeRule", () => {
	it("drops conditions nothing can read", () => {
		const rule = normalizeRule({
			match: "any",
			conditions: [
				{ field: "genre", op: "has", value: "drama" },
				{ field: "invented", op: "has", value: "x" },
				{ field: "year", op: "sideways", value: "1" },
				"nonsense",
			],
			groups: [{ match: "all", conditions: [], groups: [] }],
		});
		expect(rule.match).toBe("any");
		expect(rule.conditions).toHaveLength(1);
		// An empty group carries no meaning and is not worth keeping.
		expect(rule.groups).toHaveLength(0);
	});

	it("makes an empty rule out of anything unrecognizable", () => {
		expect(ruleIsEmpty(normalizeRule(null))).toBe(true);
		expect(ruleIsEmpty(normalizeRule("all of them"))).toBe(true);
		expect(ruleIsEmpty(normalizeRule({ match: "all" }))).toBe(true);
	});
});

describe("describeRule", () => {
	it("says what the rule says", () => {
		expect(describeRule(emptyRule())).toBe("Everything");
		expect(
			describeRule({
				match: "all",
				conditions: [
					{ field: "kind", op: "is", value: "movie" },
					{ field: "rating", op: "gte", value: "4" },
				],
				groups: [],
			}),
		).toBe("Type is Movie and Your rating is at least 4");
	});

	it("reads a negated group as one", () => {
		expect(
			describeRule({
				match: "none",
				conditions: [{ field: "tone", op: "is", value: "dropped" }],
				groups: [],
			}),
		).toBe("not Progress state is Dropped");
	});

	it("names the property a property condition is about", () => {
		expect(
			describeRule({
				match: "all",
				conditions: [{ field: "property", op: "set", key: "lent_to" }],
				groups: [],
			}),
		).toBe("lent_to is set");
	});
});
