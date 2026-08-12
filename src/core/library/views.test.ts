import { describe, expect, it } from "vitest";
import { defaultLibraryConfig } from "./config";
import type { LibraryEntry } from "./entry";
import { emptyQuery, filterEntries } from "./filter";
import { describeRule, emptyRule, matchesRule, type RuleGroup } from "./rules";
import {
	mergeRules,
	normalizeViews,
	queryIsNarrowed,
	ruleFromQuery,
	viewEntries,
	viewFromQuery,
} from "./views";

const config = defaultLibraryConfig();

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
		created: 0,
		modified: 0,
		frontmatter: {},
		...overrides,
	};
}

const LIBRARY = [
	entry("Arrival", { year: 2016, rating: 4.5, tags: ["Science Fiction"] }),
	entry("Dune", { year: 2021, rating: 4, tags: ["Science Fiction"] }),
	entry("Heat", { year: 1995, rating: 5, tags: ["Crime"] }),
	entry("Persepolis", { year: 2007, kind: "book", tags: ["Memoir"] }),
];

const scifi: RuleGroup = {
	match: "all",
	conditions: [{ field: "genre", op: "has", value: "science fiction" }],
	groups: [],
};

describe("viewEntries", () => {
	it("rules, sorts and caps, in that order", () => {
		const out = viewEntries(
			LIBRARY,
			{ rule: scifi, sortBy: "rating-desc", limit: 1 },
			config,
		);
		// Heat is rated highest but is not science fiction; the cap lands after
		// the rule, so the answer is the best of what survived it.
		expect(out.map((e) => e.title)).toEqual(["Arrival"]);
	});

	it("is the plain library when the view says nothing", () => {
		const out = viewEntries(
			LIBRARY,
			{ rule: emptyRule(), sortBy: "title" },
			config,
		);
		expect(out).toHaveLength(LIBRARY.length);
	});
});

describe("ruleFromQuery", () => {
	// The point of the translation: the toolbar and the conditions were two
	// descriptions of one set, and only one of them can be the record.
	it("says the same thing the filters said", () => {
		const query = {
			...emptyQuery(config),
			kinds: ["movie" as const],
			tags: ["Science Fiction"],
			minRating: 4,
		};
		const rule = ruleFromQuery(query);
		const byQuery = filterEntries(LIBRARY, query, config).map((e) => e.title);
		const byRule = LIBRARY.filter((e) => matchesRule(e, rule, config)).map(
			(e) => e.title,
		);
		expect(byRule).toEqual(byQuery);
		expect(byRule).toEqual(["Arrival", "Dune"]);
	});

	it("ands the genres and ors the types", () => {
		const rule = ruleFromQuery({
			...emptyQuery(config),
			kinds: ["movie", "book"],
			tags: ["Crime", "Drama"],
		});
		// Two genres, both required, so two conditions on the outer "all".
		expect(rule.conditions.filter((c) => c.field === "genre")).toHaveLength(2);
		// Two types, either will do, so a nested group that matches any.
		expect(rule.groups).toHaveLength(1);
		expect(rule.groups[0]?.match).toBe("any");
		expect(rule.groups[0]?.conditions).toHaveLength(2);
	});

	it("keeps the favourite and the search box", () => {
		const rule = ruleFromQuery({
			...emptyQuery(config),
			favoritesOnly: true,
			text: "  nolan  ",
		});
		expect(describeRule(rule)).toContain("Favourite");
		expect(rule.conditions.some((c) => c.value === "nolan")).toBe(true);
	});

	it("is empty when the toolbar is", () => {
		const rule = ruleFromQuery(emptyQuery(config));
		expect(rule.conditions).toEqual([]);
		expect(rule.groups).toEqual([]);
		expect(describeRule(rule)).toBe("Everything");
	});
});

describe("queryIsNarrowed", () => {
	it("ignores the sort and the grouping, which narrow nothing", () => {
		const base = emptyQuery(config);
		expect(queryIsNarrowed(base)).toBe(false);
		expect(queryIsNarrowed({ ...base, sortBy: "title", groupBy: "kind" })).toBe(
			false,
		);
		expect(queryIsNarrowed({ ...base, text: "   " })).toBe(false);
		expect(queryIsNarrowed({ ...base, minRating: 4 })).toBe(true);
		expect(queryIsNarrowed({ ...base, favoritesOnly: true })).toBe(true);
	});
});

describe("mergeRules", () => {
	it("folds into an existing 'all' rather than nesting it", () => {
		const merged = mergeRules(scifi, ruleFromQuery({ ...emptyQuery(config), minRating: 4 }));
		expect(merged.match).toBe("all");
		expect(merged.conditions).toHaveLength(2);
		expect(merged.groups).toHaveLength(0);
	});

	it("nests when the existing rule is not an 'all'", () => {
		const any: RuleGroup = { ...scifi, match: "any" };
		const merged = mergeRules(any, scifi);
		expect(merged.match).toBe("all");
		expect(merged.groups).toHaveLength(2);
	});

	it("leaves either side alone when the other is empty", () => {
		expect(mergeRules(scifi, emptyRule())).toBe(scifi);
		expect(mergeRules(emptyRule(), scifi)).toBe(scifi);
	});
});

describe("viewFromQuery", () => {
	it("keeps the sort and the grouping the library was on", () => {
		const view = viewFromQuery(
			{ ...emptyQuery(config), tags: ["Drama"], sortBy: "title", groupBy: "kind" },
			"grid",
			"Dramas",
		);
		expect(view.sortBy).toBe("title");
		expect(view.groupBy).toBe("kind");
		expect(view.layout).toBe("grid");
		expect(view.name).toBe("Dramas");
		expect(describeRule(view.rule)).toContain("Drama");
	});

	it("never ends up nameless", () => {
		expect(viewFromQuery(emptyQuery(config), "list", "   ").name).toBe(
			"New view",
		);
	});
});

describe("normalizeViews", () => {
	it("fills in what an older release never wrote", () => {
		const out = normalizeViews([{ name: "On the go" }], config);
		expect(out).toHaveLength(1);
		expect(out[0]?.id).toBeTruthy();
		expect(out[0]?.icon).toBe("list-filter");
		expect(out[0]?.layout).toBeNull();
		expect(out[0]?.sortBy).toBe(config.sortBy);
		expect(out[0]?.groupBy).toBe(config.groupBy);
	});

	// Views stored their filters as a copy of the toolbar before the two
	// became one; reading one of those must not lose what it showed.
	it("turns a stored query into conditions", () => {
		const out = normalizeViews(
			[
				{
					name: "Sci-fi I loved",
					query: {
						tags: ["Science Fiction"],
						minRating: 4,
						sortBy: "rating-desc",
						groupBy: "year",
					},
					rule: {
						match: "all",
						conditions: [{ field: "year", op: "gte", value: "2010" }],
						groups: [],
					},
				},
			],
			config,
		);
		const view = out[0];
		expect(view?.sortBy).toBe("rating-desc");
		expect(view?.groupBy).toBe("year");
		// The rule it already had, and the filters it used to keep separately.
		expect(view?.rule.conditions).toHaveLength(3);
		const shown = LIBRARY.filter((e) =>
			matchesRule(e, view?.rule ?? emptyRule(), config),
		).map((e) => e.title);
		// Both sci-fi films are recent enough and rated highly enough; Heat and
		// Persepolis are held out by the genre the query used to carry.
		expect(shown).toEqual(["Arrival", "Dune"]);
	});

	it("drops entries with no name and anything that is not a list", () => {
		expect(normalizeViews([{ icon: "x" }], config)).toEqual([]);
		expect(normalizeViews("views", config)).toEqual([]);
	});
});
