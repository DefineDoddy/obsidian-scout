import { MEDIA_KIND_LABELS, type MediaKind } from "../types";
import {
	ratingFraction,
	statusTone,
	type LibraryConfig,
	type StatusTone,
} from "./config";
import { customValue, type LibraryEntry } from "./entry";

/**
 * Rules: one condition language, used by everything that has to describe a set
 * of things without listing them.
 *
 * Two features asked for the same thing at once. A saved view is "the library,
 * narrowed to what I care about right now"; a collection that fills itself is
 * "everything that qualifies, including the things I have not added yet". Those
 * are the same sentence with a different verb, so they are the same code: build
 * the condition once, and let a view read it as a filter and a collection read
 * it as a membership test.
 *
 * The shape is a group rather than a flat list because "sci-fi or fantasy, made
 * this decade, that I have not dropped" is three ideas at two levels, and a
 * single row of ANDed rows cannot say it. Groups nest, and `none` gives the
 * exclusion arm without doubling every operator into a negated twin.
 *
 * Pure: no Obsidian, no clock of its own — `now` is passed in, so "in the last
 * thirty days" is testable.
 */

/* ------------------------------------------------------------------ the model */

export type RuleField =
	| "title"
	| "kind"
	| "status"
	| "tone"
	| "genre"
	| "person"
	| "collection"
	| "year"
	| "rating"
	| "sourceRating"
	| "progress"
	| "favorite"
	| "added"
	| "updated"
	| "started"
	| "finished"
	| "property";

export type RuleOp =
	/** Exact, case-insensitive. `value` may be a comma-separated list: any of. */
	| "is"
	| "is-not"
	/** Substring, for the text fields. */
	| "contains"
	| "not-contains"
	/** For the list fields: carries at least one of the named values. */
	| "has"
	| "has-not"
	| "gte"
	| "lte"
	| "between"
	/** Within the last `value` days. */
	| "within"
	| "before"
	| "after"
	| "set"
	| "unset";

export interface Condition {
	field: RuleField;
	op: RuleOp;
	/** Always text. Numbers and dates are parsed at comparison time. */
	value?: string;
	/** The far end of `between`. */
	value2?: string;
	/** Which property, for `field: "property"`. */
	key?: string;
}

/**
 * `all` and `any` are the obvious two. `none` is the one that earns its place:
 * every real filter someone writes has an "except" in it, and the alternative
 * is a negated form of all fifteen operators.
 */
export type RuleMatch = "all" | "any" | "none";

export interface RuleGroup {
	match: RuleMatch;
	conditions: Condition[];
	/** Nested groups, evaluated as further members of this one. */
	groups: RuleGroup[];
}

export function emptyRule(match: RuleMatch = "all"): RuleGroup {
	return { match, conditions: [], groups: [] };
}

/** Whether a rule actually says anything. An empty one matches everything. */
export function ruleIsEmpty(rule: RuleGroup | null | undefined): boolean {
	if (!rule) return true;
	return (
		rule.conditions.length === 0 && rule.groups.every((g) => ruleIsEmpty(g))
	);
}

/* ------------------------------------------------------------- field metadata */

export type RuleValueType = "text" | "list" | "kind" | "tone" | "number" | "date" | "boolean";

export const RULE_FIELDS: Record<
	RuleField,
	{ label: string; type: RuleValueType }
> = {
	title: { label: "Title", type: "text" },
	kind: { label: "Type", type: "kind" },
	status: { label: "Status", type: "text" },
	tone: { label: "Progress state", type: "tone" },
	genre: { label: "Genre", type: "list" },
	person: { label: "Person", type: "list" },
	collection: { label: "Collection", type: "list" },
	year: { label: "Year", type: "number" },
	rating: { label: "Your rating", type: "number" },
	sourceRating: { label: "Source rating", type: "number" },
	progress: { label: "Progress", type: "number" },
	favorite: { label: "Favourite", type: "boolean" },
	added: { label: "Added", type: "date" },
	updated: { label: "Last updated", type: "date" },
	started: { label: "Started on", type: "date" },
	finished: { label: "Finished on", type: "date" },
	property: { label: "Any property", type: "text" },
};

/** Which operators make sense for a field, in the order a menu should list them. */
export function operatorsFor(field: RuleField): RuleOp[] {
	switch (RULE_FIELDS[field].type) {
		case "list":
			return ["has", "has-not", "set", "unset"];
		case "kind":
		case "tone":
			return ["is", "is-not"];
		case "number":
			return ["gte", "lte", "between", "is", "set", "unset"];
		case "date":
			return ["within", "after", "before", "set", "unset"];
		case "boolean":
			return ["is"];
		default:
			return ["is", "is-not", "contains", "not-contains", "set", "unset"];
	}
}

export const OP_LABELS: Record<RuleOp, string> = {
	is: "is",
	"is-not": "is not",
	contains: "contains",
	"not-contains": "does not contain",
	has: "includes",
	"has-not": "does not include",
	gte: "is at least",
	lte: "is at most",
	between: "is between",
	within: "is within the last",
	before: "is before",
	after: "is after",
	set: "is set",
	unset: "is not set",
};

/** Operators that need nothing typed after them. */
export function opTakesValue(op: RuleOp): boolean {
	return op !== "set" && op !== "unset";
}

export const TONE_LABELS: Record<StatusTone, string> = {
	planned: "Not started",
	active: "In progress",
	done: "Finished",
	paused: "On hold",
	dropped: "Dropped",
};

/* --------------------------------------------------------------- evaluation */

const lower = (value: string) => value.trim().toLowerCase();

/**
 * A condition's value as a list — "sci-fi, fantasy" is two answers, not one.
 *
 * Kept against the condition object, which comes off the settings and holds
 * still: a rule is checked once per entry in the library, and splitting the
 * same short string a few thousand times per keystroke is work with a known
 * answer. A `WeakMap`, so an edited rule brings a new object and the old list
 * goes with it.
 */
const valueCache = new WeakMap<Condition, string[]>();

function values(condition: Condition): string[] {
	const found = valueCache.get(condition);
	if (found) return found;
	const parsed = (condition.value ?? "")
		.split(",")
		.map(lower)
		.filter((part) => part.length > 0);
	valueCache.set(condition, parsed);
	return parsed;
}

function num(text: string | undefined): number | undefined {
	if (text === undefined) return undefined;
	const parsed = Number(text.trim());
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** A date field as a timestamp, from either an ISO string or an epoch number. */
function stamp(value: string | number | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	const text = value.trim();
	if (!text) return undefined;
	const parsed = Date.parse(text);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** The entry's side of a comparison, in whatever shape the field comes in. */
function fieldValue(
	entry: LibraryEntry,
	condition: Condition,
	config: LibraryConfig,
): string | number | boolean | string[] | undefined {
	switch (condition.field) {
		case "title":
			return entry.title;
		case "kind":
			return entry.kind;
		case "status":
			return entry.status;
		case "tone":
			return statusTone(config, entry.status) ?? undefined;
		case "genre":
			return entry.tags;
		case "person":
			return entry.people;
		case "collection":
			return entry.collections;
		case "year":
			return entry.year;
		case "rating":
			// Proportional, like every other rating comparison in Scout: "at
			// least 4" means four fifths, whichever scale the note is on.
			return ratingFraction(config, entry.kind, entry.rating);
		case "sourceRating":
			return entry.sourceRating !== undefined && entry.sourceRating > 0
				? entry.sourceRating
				: undefined;
		case "progress":
			return entry.progress;
		case "favorite":
			return entry.favorite;
		case "added":
			return entry.created;
		case "updated":
			return entry.modified;
		case "started":
			return entry.started;
		case "finished":
			return entry.finished;
		case "property": {
			const raw = customValue(entry, condition.key ?? "");
			if (raw === undefined || raw === null) return undefined;
			if (Array.isArray(raw)) return raw.map((v) => String(v));
			if (typeof raw === "boolean" || typeof raw === "number") return raw;
			return String(raw);
		}
		default:
			return undefined;
	}
}

/** The number a condition compares against, brought onto the field's own scale. */
function threshold(
	condition: Condition,
	config: LibraryConfig,
	which: "value" | "value2" = "value",
): number | undefined {
	const parsed = num(which === "value" ? condition.value : condition.value2);
	if (parsed === undefined) return undefined;
	if (condition.field === "rating") {
		return config.ratingScale > 0 ? parsed / config.ratingScale : undefined;
	}
	return parsed;
}

const DAY = 86_400_000;

function present(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === "string") return value.trim().length > 0;
	return true;
}

export function matchesCondition(
	entry: LibraryEntry,
	condition: Condition,
	config: LibraryConfig,
	now: Date = new Date(),
): boolean {
	const actual = fieldValue(entry, condition, config);

	if (condition.op === "set") return present(actual);
	if (condition.op === "unset") return !present(actual);

	const type = RULE_FIELDS[condition.field].type;

	if (type === "boolean") {
		const wanted = !["false", "no", "0"].includes(lower(condition.value ?? "true"));
		return Boolean(actual) === wanted;
	}

	if (type === "date") {
		const at = stamp(actual as string | number | undefined);
		if (at === undefined) return false;
		switch (condition.op) {
			case "within": {
				const days = num(condition.value);
				if (days === undefined) return false;
				return at >= now.getTime() - days * DAY;
			}
			case "after": {
				const from = stamp(condition.value);
				return from !== undefined && at >= from;
			}
			case "before": {
				const until = stamp(condition.value);
				return until !== undefined && at <= until;
			}
			default:
				return false;
		}
	}

	if (type === "number") {
		if (typeof actual !== "number") return false;
		const first = threshold(condition, config);
		if (first === undefined) return false;
		switch (condition.op) {
			// A hair of tolerance, so 4/5 is not excluded from "at least 4" by
			// the last bit of a float.
			case "gte":
				return actual >= first - 1e-9;
			case "lte":
				return actual <= first + 1e-9;
			case "is":
				return Math.abs(actual - first) < 1e-9;
			case "between": {
				const second = threshold(condition, config, "value2");
				if (second === undefined) return false;
				const [low, high] = first <= second ? [first, second] : [second, first];
				return actual >= low - 1e-9 && actual <= high + 1e-9;
			}
			default:
				return false;
		}
	}

	const wanted = values(condition);
	if (wanted.length === 0) return false;

	if (Array.isArray(actual)) {
		const own = actual.map(lower);
		const hit = wanted.some((value) => own.includes(value));
		return condition.op === "has-not" ? !hit : hit;
	}

	const text = actual === undefined ? "" : lower(String(actual));
	switch (condition.op) {
		case "is":
			return wanted.includes(text);
		case "is-not":
			return !wanted.includes(text);
		case "contains":
			return wanted.some((value) => text.includes(value));
		case "not-contains":
			return !wanted.some((value) => text.includes(value));
		// `has` on a single-valued field is the same question as `is`, and a
		// field changed from a list to a text in the editor should not silently
		// stop matching.
		case "has":
			return wanted.includes(text);
		case "has-not":
			return !wanted.includes(text);
		default:
			return false;
	}
}

export function matchesRule(
	entry: LibraryEntry,
	rule: RuleGroup | null | undefined,
	config: LibraryConfig,
	now: Date = new Date(),
): boolean {
	if (ruleIsEmpty(rule) || !rule) return true;

	/**
	 * Answered one condition at a time and stopped as soon as the answer is
	 * settled, rather than collecting every result into two arrays first. Same
	 * verdict, but a rule is asked once per note in the library and the arrays
	 * were being built each time.
	 */
	const match = rule.match;
	const decide = (hit: boolean): boolean | null => {
		if (hit) return match === "any" ? true : match === "none" ? false : null;
		return match === "all" ? false : null;
	};

	let asked = 0;
	for (const condition of rule.conditions) {
		asked++;
		const settled = decide(matchesCondition(entry, condition, config, now));
		if (settled !== null) return settled;
	}
	for (const group of rule.groups) {
		if (ruleIsEmpty(group)) continue;
		asked++;
		const settled = decide(matchesRule(entry, group, config, now));
		if (settled !== null) return settled;
	}

	// Nothing to go on is not grounds to exclude anything. Otherwise: "all" and
	// "none" reached the end without being contradicted, "any" without a hit.
	if (asked === 0) return true;
	return match !== "any";
}

/* ---------------------------------------------------------------- normalizing */

/**
 * A rule read back off disk, made safe to evaluate.
 *
 * Plugin data is a JSON file a user can edit and an older release can have
 * written, so nothing here trusts its shape. Unknown fields and operators are
 * dropped rather than defaulted: a condition nobody can read is better gone
 * than silently turned into one that matches everything.
 */
export function normalizeRule(raw: unknown): RuleGroup {
	if (!raw || typeof raw !== "object") return emptyRule();
	const source = raw as Partial<RuleGroup>;
	const match: RuleMatch =
		source.match === "any" || source.match === "none" ? source.match : "all";

	const conditions: Condition[] = [];
	for (const item of Array.isArray(source.conditions) ? source.conditions : []) {
		if (!item || typeof item !== "object") continue;
		const condition = item as Partial<Condition>;
		if (!condition.field || !(condition.field in RULE_FIELDS)) continue;
		if (!condition.op || !(condition.op in OP_LABELS)) continue;
		const out: Condition = { field: condition.field, op: condition.op };
		if (typeof condition.value === "string") out.value = condition.value;
		if (typeof condition.value2 === "string") out.value2 = condition.value2;
		if (typeof condition.key === "string") out.key = condition.key;
		conditions.push(out);
	}

	const groups = (Array.isArray(source.groups) ? source.groups : [])
		.map((group) => normalizeRule(group))
		.filter((group) => !ruleIsEmpty(group));

	return { match, conditions, groups };
}

/* ----------------------------------------------------------------- describing */

const MATCH_JOIN: Record<RuleMatch, string> = {
	all: " and ",
	any: " or ",
	none: " or ",
};

function describeValue(condition: Condition): string {
	const raw = (condition.value ?? "").trim();
	if (condition.field === "kind") {
		return raw
			.split(",")
			.map((part) => {
				const kind = lower(part) as MediaKind;
				return MEDIA_KIND_LABELS[kind] ?? part.trim();
			})
			.filter(Boolean)
			.join(" or ");
	}
	if (condition.field === "tone") {
		return raw
			.split(",")
			.map((part) => TONE_LABELS[lower(part) as StatusTone] ?? part.trim())
			.filter(Boolean)
			.join(" or ");
	}
	return raw.split(",").map((part) => part.trim()).filter(Boolean).join(" or ");
}

export function describeCondition(condition: Condition): string {
	const name =
		condition.field === "property"
			? condition.key?.trim() || "property"
			: RULE_FIELDS[condition.field].label;
	const op = OP_LABELS[condition.op];
	if (!opTakesValue(condition.op)) return `${name} ${op}`;
	if (condition.op === "between") {
		return `${name} ${op} ${condition.value ?? "?"} and ${condition.value2 ?? "?"}`;
	}
	if (condition.op === "within") {
		return `${name} ${op} ${condition.value ?? "?"} days`;
	}
	return `${name} ${op} ${describeValue(condition) || "?"}`;
}

/**
 * The rule as a sentence.
 *
 * Shown under the name of a view or a collection, because a rule you cannot
 * read is a rule you cannot trust to be adding the right things behind your
 * back — and this one is adding things to your library behind your back.
 */
export function describeRule(rule: RuleGroup | null | undefined): string {
	if (ruleIsEmpty(rule) || !rule) return "Everything";

	const parts = [
		...rule.conditions.map(describeCondition),
		...rule.groups
			.filter((group) => !ruleIsEmpty(group))
			.map((group) => `(${describeRule(group)})`),
	];
	const joined = parts.join(MATCH_JOIN[rule.match]);
	return rule.match === "none" ? `not ${joined}` : joined;
}
