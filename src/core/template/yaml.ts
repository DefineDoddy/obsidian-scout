/**
 * YAML emission for frontmatter.
 *
 * The previous templates wrote `title: "{{title}}"`, which produced invalid
 * frontmatter for any title containing a double quote, and wrote genres as one
 * joined string so Dataview could not query them. Everything here exists to
 * make those two classes of bug impossible.
 */

/** Plain scalars that YAML would otherwise read as a non-string type. */
const RESERVED_WORDS =
	/^(y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|null|Null|NULL|~)$/;

/** Characters that carry meaning at the start of a plain scalar. */
const LEADING_INDICATORS = new Set([
	"-",
	"?",
	":",
	",",
	"[",
	"]",
	"{",
	"}",
	"#",
	"&",
	"*",
	"!",
	"|",
	">",
	"'",
	'"',
	"%",
	"@",
	"`",
]);

export function needsQuoting(value: string): boolean {
	if (value === "") return true;
	if (value !== value.trim()) return true;
	if (RESERVED_WORDS.test(value)) return true;
	// Anything that would parse as a number must be quoted to stay a string.
	if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value)) return true;
	if (LEADING_INDICATORS.has(value[0] ?? "")) return true;
	if (/[\n\r\t]/.test(value)) return true;
	if (value.includes(": ") || value.endsWith(":")) return true;
	if (value.includes(" #")) return true;
	return false;
}

/**
 * A YAML double-quoted scalar. JSON string escaping is a valid subset of
 * YAML's double-quoted style, so `JSON.stringify` is exactly right here.
 */
export function quoteScalar(value: string): string {
	return JSON.stringify(value);
}

/** Renders any value as a YAML scalar, quoting only when necessary. */
export function yamlScalar(value: string | number | boolean): string {
	if (typeof value === "number") {
		return Number.isFinite(value) ? String(value) : '""';
	}
	if (typeof value === "boolean") return String(value);
	return needsQuoting(value) ? quoteScalar(value) : value;
}

/**
 * Flow sequence: `["Action", "Drama"]`.
 *
 * Flow rather than block style because a placeholder sits mid-line
 * (`tags: {{tags}}`) and has no way to know its own indentation. Flow style is
 * position-independent and parses identically for Dataview.
 */
export function yamlFlowList(values: readonly (string | number)[]): string {
	if (values.length === 0) return "[]";
	return `[${values.map((v) => yamlQuotedItem(v)).join(", ")}]`;
}

/** Inside a flow sequence, `,` `]` and `[` must be quoted even mid-scalar. */
function yamlQuotedItem(value: string | number): string {
	if (typeof value === "number") return String(value);
	if (needsQuoting(value) || /[,[\]{}]/.test(value)) return quoteScalar(value);
	return value;
}

/**
 * Escapes for interpolation *inside* quotes the user already wrote, e.g. a
 * template that says `title: "{{title}}"`. Adding another layer of quotes
 * there would break the document, so only the inner content is escaped.
 */
export function escapeInsideDoubleQuotes(value: string): string {
	// Strip the outer quotes JSON.stringify adds.
	return quoteScalar(value).slice(1, -1);
}

export function escapeInsideSingleQuotes(value: string): string {
	// YAML single-quoted style escapes a quote by doubling it; nothing else.
	return value.replace(/'/g, "''").replace(/[\n\r]/g, " ");
}
