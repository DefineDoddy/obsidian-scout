import type { TemplateValue } from "../types";
import { yamlFlowList } from "./yaml";

/** Marks a string as already formatted, so the renderer will not re-escape it. */
export class Raw {
	constructor(readonly text: string) {}
}

export type RenderMode = "yaml" | "body";

export interface FilterContext {
	mode: RenderMode;
}

export type Filter = (
	value: TemplateValue,
	args: readonly string[],
	ctx: FilterContext,
) => TemplateValue | Raw;

const asArray = (value: TemplateValue): string[] => {
	if (value === null || value === undefined) return [];
	if (Array.isArray(value)) return value.map(String);
	return [String(value)];
};

const asText = (value: TemplateValue): string =>
	value === null || value === undefined ? "" : String(value);

/** Formats an ISO-ish date. Supports YYYY, MM, DD, MMM, MMMM. */
function formatDate(input: string, pattern: string): string {
	const date = new Date(input);
	if (Number.isNaN(date.getTime())) return input;
	const months = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	];
	const month = months[date.getUTCMonth()] ?? "";
	// Longest tokens first so MMMM is not consumed as MM+MM.
	return pattern
		.replace(/YYYY/g, String(date.getUTCFullYear()))
		.replace(/MMMM/g, month)
		.replace(/MMM/g, month.slice(0, 3))
		.replace(/MM/g, String(date.getUTCMonth() + 1).padStart(2, "0"))
		.replace(/DD/g, String(date.getUTCDate()).padStart(2, "0"));
}

export const FILTERS: Record<string, Filter> = {
	/** Renders a list as a YAML sequence in frontmatter, or prose in the body. */
	list: (value, _args, ctx) => {
		const items = asArray(value);
		return ctx.mode === "yaml"
			? new Raw(yamlFlowList(items))
			: new Raw(items.join(", "));
	},

	/** Markdown bullet list, one item per line. Body only. */
	bullets: (value) =>
		new Raw(
			asArray(value)
				.map((v) => `- ${v}`)
				.join("\n"),
		),

	/** Wikilinks each item: `[[Ridley Scott]]`. */
	link: (value, _args, ctx) => {
		const linked = asArray(value).map((v) => `[[${v}]]`);
		if (ctx.mode === "yaml") return new Raw(yamlFlowList(linked));
		return new Raw(linked.join(", "));
	},

	join: (value, args) => asArray(value).join(args[0] ?? ", "),

	first: (value) => asArray(value)[0] ?? "",

	/** Keeps the first N items of a list. */
	take: (value, args) => asArray(value).slice(0, Number(args[0] ?? 3)),

	date: (value, args) => {
		const text = asText(value);
		return text ? formatDate(text, args[0] ?? "YYYY-MM-DD") : "";
	},

	upper: (value) => asText(value).toUpperCase(),
	lower: (value) => asText(value).toLowerCase(),

	truncate: (value, args) => {
		const text = asText(value);
		const max = Number(args[0] ?? 200);
		return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
	},

	/** Rounds a number to N decimal places. */
	round: (value, args) => {
		const num = Number(value);
		if (!Number.isFinite(num)) return "";
		const places = Number(args[0] ?? 1);
		return Number(num.toFixed(places));
	},

	/** Rescales a rating onto a 0-N range, e.g. Goodreads' 5-point scale. */
	scale: (value, args) => {
		const num = Number(value);
		if (!Number.isFinite(num)) return "";
		const from = Number(args[0] ?? 10);
		const to = Number(args[1] ?? 5);
		return Number(((num / from) * to).toFixed(1));
	},

	/** Substitute when the value is empty. */
	default: (value, args) => {
		const empty =
			value === null ||
			value === undefined ||
			value === "" ||
			(Array.isArray(value) && value.length === 0);
		return empty ? (args[0] ?? "") : value;
	},

	/** Filename- and wikilink-safe slug. */
	slug: (value) =>
		asText(value)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, ""),
};
