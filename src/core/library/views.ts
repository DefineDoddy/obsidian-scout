import type { LibraryLayout } from "./config";
import type { LibraryConfig, LibraryGroupBy, LibrarySort } from "./config";
import type { LibraryEntry } from "./entry";
import { sortEntries, type LibraryQuery } from "./filter";
import {
	emptyRule,
	matchesRule,
	normalizeRule,
	ruleIsEmpty,
	type Condition,
	type RuleGroup,
} from "./rules";

/**
 * Saved views.
 *
 * A library view is a question, and most people only ever ask four or five —
 * "what am I part-way through", "what's on the pile", "films I loved", "the
 * shelf, by year". Setting six controls to ask one of them again is the sort of
 * work an app should do once and remember.
 *
 * A view is a rule and a presentation, and nothing else. It used to be a rule
 * *and* a copy of the toolbar's filters, which meant two places said which
 * entries it showed — the same sentence twice, in two dialects, with no answer
 * to what should happen when they disagreed. The toolbar is still how a view
 * gets made: filter the library by pointing at it, press New view, and what the
 * dropdowns said is written down as conditions. From then on there is one place
 * it lives, and it can be edited by someone who never saw the toolbar.
 *
 * Pure: no Obsidian, no clock of its own.
 */

export interface SavedView {
	/** Stable across renames. */
	id: string;
	name: string;
	/** A lucide glyph name. */
	icon: string;
	/** Which entries it shows. Empty means the whole library. */
	rule: RuleGroup;
	sortBy: LibrarySort;
	groupBy: LibraryGroupBy;
	/** Null leaves the library's own layout alone. */
	layout: LibraryLayout | null;
	/** Grid card width, when the view wants one of its own. */
	cardSize?: number;
	/** Stops after this many entries — for a "top ten" that is actually ten. */
	limit?: number;
}

export function newViewId(now: Date = new Date()): string {
	return `v${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A view of the whole library, as the starting point for a new one. */
export function emptyView(config: LibraryConfig, name = "New view"): SavedView {
	return {
		id: newViewId(),
		name,
		icon: "list-filter",
		rule: emptyRule(),
		sortBy: config.sortBy,
		groupBy: config.groupBy,
		layout: null,
	};
}

/* ------------------------------------------------------- toolbar → conditions */

/**
 * What the filter row is saying, as conditions.
 *
 * Every control on the toolbar has a condition that means the same thing, which
 * is what makes one of the two redundant. Translating rather than storing the
 * query keeps the quick way in — filter, then save — without keeping two
 * descriptions of the same set.
 *
 * Several genres become several conditions because the toolbar means "and";
 * several types become a nested "any" group because it means "or".
 */
export function ruleFromQuery(query: LibraryQuery): RuleGroup {
	const conditions: Condition[] = [];
	const groups: RuleGroup[] = [];

	const anyOf = (values: string[], make: (value: string) => Condition) => {
		if (values.length === 0) return;
		if (values.length === 1) {
			const only = values[0];
			if (only !== undefined) conditions.push(make(only));
			return;
		}
		groups.push({ match: "any", conditions: values.map(make), groups: [] });
	};

	const text = query.text.trim();
	// The toolbar's box searches people and tags as well as the title, which no
	// single condition can say; the title is the part worth keeping, and it is
	// visible afterwards rather than baked into a copy nobody can see.
	if (text) conditions.push({ field: "title", op: "contains", value: text });

	anyOf(query.kinds, (value) => ({ field: "kind", op: "is", value }));
	anyOf(query.statuses, (value) => ({ field: "status", op: "is", value }));
	for (const tag of query.tags) {
		conditions.push({ field: "genre", op: "has", value: tag });
	}
	for (const name of query.collections) {
		conditions.push({ field: "collection", op: "has", value: name });
	}
	if (query.favoritesOnly) {
		conditions.push({ field: "favorite", op: "is", value: "true" });
	}
	if (query.minRating > 0) {
		conditions.push({
			field: "rating",
			op: "gte",
			value: String(query.minRating),
		});
	}

	return { match: "all", conditions, groups };
}

/** Whether the toolbar is narrowing anything, sort and grouping aside. */
export function queryIsNarrowed(query: LibraryQuery): boolean {
	return (
		query.text.trim() !== "" ||
		query.kinds.length > 0 ||
		query.statuses.length > 0 ||
		query.tags.length > 0 ||
		query.collections.length > 0 ||
		query.favoritesOnly ||
		query.minRating > 0
	);
}

/**
 * Both rules, and-ed.
 *
 * Flattened into the existing group when that group is already an "all", so
 * folding the toolbar into a view twice does not build a tower of nested groups
 * nobody can read back.
 */
export function mergeRules(base: RuleGroup, extra: RuleGroup): RuleGroup {
	if (ruleIsEmpty(extra)) return base;
	if (ruleIsEmpty(base)) return extra;
	if (base.match === "all") {
		return {
			match: "all",
			conditions: [...base.conditions, ...extra.conditions],
			groups: [...base.groups, ...extra.groups],
		};
	}
	return { match: "all", conditions: [], groups: [base, extra] };
}

/** The view the toolbar is showing right now, ready to be named and kept. */
export function viewFromQuery(
	query: LibraryQuery,
	layout: LibraryLayout,
	name: string,
): SavedView {
	return {
		id: newViewId(),
		name: name.trim() || "New view",
		rule: ruleFromQuery(query),
		icon: "list-filter",
		sortBy: query.sortBy,
		groupBy: query.groupBy,
		layout,
	};
}

/* ---------------------------------------------------------------- normalizing */

/** The shape views were stored in before the filters became conditions. */
interface StoredQuery extends Partial<LibraryQuery> {}

function storedRule(stored: Partial<SavedView> & { query?: unknown }): RuleGroup {
	const rule = normalizeRule(stored.rule);
	const raw = stored.query;
	if (!raw || typeof raw !== "object") return rule;
	// A view saved by an earlier build: its filters are read once, turned into
	// conditions, and never written back in the old shape.
	const query = raw as StoredQuery;
	const list = (value: unknown): string[] =>
		Array.isArray(value)
			? value.filter((v): v is string => typeof v === "string")
			: [];
	return mergeRules(
		rule,
		ruleFromQuery({
			text: typeof query.text === "string" ? query.text : "",
			kinds: list(query.kinds) as LibraryQuery["kinds"],
			statuses: list(query.statuses),
			tags: list(query.tags),
			collections: list(query.collections),
			favoritesOnly: Boolean(query.favoritesOnly),
			minRating:
				typeof query.minRating === "number" && Number.isFinite(query.minRating)
					? query.minRating
					: 0,
			sortBy: "recent",
			groupBy: "none",
		}),
	);
}

export function normalizeViews(raw: unknown, config: LibraryConfig): SavedView[] {
	if (!Array.isArray(raw)) return [];
	const out: SavedView[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const stored = item as Partial<SavedView> & { query?: { sortBy?: unknown; groupBy?: unknown } };
		const name = typeof stored.name === "string" ? stored.name.trim() : "";
		if (!name) continue;
		const sortBy = stored.sortBy ?? stored.query?.sortBy;
		const groupBy = stored.groupBy ?? stored.query?.groupBy;
		out.push({
			id: typeof stored.id === "string" && stored.id ? stored.id : newViewId(),
			name,
			icon: typeof stored.icon === "string" && stored.icon ? stored.icon : "list-filter",
			rule: storedRule(stored),
			sortBy: (typeof sortBy === "string" ? sortBy : config.sortBy) as LibrarySort,
			groupBy: (typeof groupBy === "string"
				? groupBy
				: config.groupBy) as LibraryGroupBy,
			layout:
				stored.layout === "grid" ||
				stored.layout === "list" ||
				stored.layout === "table"
					? stored.layout
					: null,
			...(typeof stored.cardSize === "number" && stored.cardSize > 0
				? { cardSize: stored.cardSize }
				: {}),
			...(typeof stored.limit === "number" && stored.limit > 0
				? { limit: Math.floor(stored.limit) }
				: {}),
		});
	}
	return out;
}

/* ------------------------------------------------------------------ applying */

/**
 * The entries a view shows, ruled, sorted and capped.
 *
 * The caller filters first if the toolbar is narrowing on top of the view, and
 * groups afterwards: doing either here would mean this function took the whole
 * page's state or returned two different shapes.
 */
export function viewEntries(
	entries: readonly LibraryEntry[],
	view: Pick<SavedView, "rule" | "sortBy"> & Pick<Partial<SavedView>, "limit">,
	config: LibraryConfig,
	now: Date = new Date(),
): LibraryEntry[] {
	let out = ruleIsEmpty(view.rule)
		? [...entries]
		: entries.filter((entry) => matchesRule(entry, view.rule, config, now));
	out = sortEntries(out, view.sortBy, config);
	return view.limit && view.limit > 0 ? out.slice(0, view.limit) : out;
}

/** How many entries a view would show — for the count on its tab. */
export function viewCount(
	entries: readonly LibraryEntry[],
	view: Pick<SavedView, "rule" | "sortBy"> & Pick<Partial<SavedView>, "limit">,
	config: LibraryConfig,
	now: Date = new Date(),
): number {
	return viewEntries(entries, view, config, now).length;
}
