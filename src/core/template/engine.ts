import type { TemplateValue } from "../types";
import { FILTERS, Raw, type RenderMode } from "./filters";
import {
	escapeInsideDoubleQuotes,
	escapeInsideSingleQuotes,
	yamlFlowList,
	yamlScalar,
} from "./yaml";

/**
 * Template engine.
 *
 * Replaces the two divergent `replacePlaceholders` implementations (one in
 * `tvUtils`, one in `bookUtils`) with a single renderer that understands where
 * in the document it is. The important property is that frontmatter is emitted
 * as valid YAML no matter what characters the metadata contains.
 */

interface FilterCall {
	name: string;
	args: string[];
}

interface Expr {
	name: string;
	filters: FilterCall[];
}

type Node =
	| { kind: "text"; value: string }
	| { kind: "interp"; expr: Expr }
	| { kind: "if"; expr: Expr; negate: boolean; then: Node[]; otherwise: Node[] }
	| { kind: "each"; expr: Expr; body: Node[] };

export interface RenderResult {
	content: string;
	/** Placeholders in the template that the provider supplied no field for. */
	missing: string[];
}

export class TemplateError extends Error {}

/* ------------------------------------------------------------------ parsing */

function parseExpr(source: string): Expr {
	const [head = "", ...rest] = source.split("|");
	return {
		name: head.trim(),
		filters: rest.map((part) => {
			const segments = part.trim().split(":");
			return {
				name: (segments.shift() ?? "").trim(),
				args: segments.map((a) => a.trim()),
			};
		}),
	};
}

function parse(template: string): Node[] {
	const root: Node[] = [];
	// Stack of open blocks. New nodes append to the innermost open branch.
	const stack: { node: Node; inElse: boolean }[] = [];
	const current = (): Node[] => {
		const top = stack[stack.length - 1];
		if (!top) return root;
		if (top.node.kind === "if") {
			return top.inElse ? top.node.otherwise : top.node.then;
		}
		if (top.node.kind === "each") return top.node.body;
		return root;
	};

	let cursor = 0;
	while (cursor < template.length) {
		const open = template.indexOf("{{", cursor);
		if (open === -1) break;
		const close = template.indexOf("}}", open + 2);
		if (close === -1) break;

		if (open > cursor) {
			current().push({ kind: "text", value: template.slice(cursor, open) });
		}

		const tag = template.slice(open + 2, close).trim();
		cursor = close + 2;

		if (tag.startsWith("#if ") || tag.startsWith("#unless ")) {
			const negate = tag.startsWith("#unless ");
			const node: Node = {
				kind: "if",
				expr: parseExpr(tag.slice(negate ? 8 : 4)),
				negate,
				then: [],
				otherwise: [],
			};
			current().push(node);
			stack.push({ node, inElse: false });
			continue;
		}

		if (tag === "else") {
			const top = stack[stack.length - 1];
			if (!top || top.node.kind !== "if") {
				throw new TemplateError("{{else}} outside of an {{#if}} block");
			}
			top.inElse = true;
			continue;
		}

		if (tag === "/if") {
			const top = stack.pop();
			if (!top || top.node.kind !== "if") {
				throw new TemplateError("Unmatched {{/if}}");
			}
			continue;
		}

		if (tag.startsWith("#each ")) {
			const node: Node = {
				kind: "each",
				expr: parseExpr(tag.slice(6)),
				body: [],
			};
			current().push(node);
			stack.push({ node, inElse: false });
			continue;
		}

		if (tag === "/each") {
			const top = stack.pop();
			if (!top || top.node.kind !== "each") {
				throw new TemplateError("Unmatched {{/each}}");
			}
			continue;
		}

		current().push({ kind: "interp", expr: parseExpr(tag) });
	}

	if (cursor < template.length) {
		current().push({ kind: "text", value: template.slice(cursor) });
	}
	if (stack.length > 0) {
		throw new TemplateError("Unclosed {{#if}} or {{#each}} block");
	}
	return root;
}

/* ----------------------------------------------------------------- emission */

function isEmpty(value: TemplateValue): boolean {
	if (value === null || value === undefined || value === "") return true;
	if (Array.isArray(value)) return value.length === 0;
	if (value === false) return true;
	return false;
}

/**
 * Chooses how to write a value given the characters that surround the
 * placeholder. This is what makes existing user templates keep working:
 * `title: "{{title}}"` escapes *inside* the quotes the user wrote rather than
 * adding a second pair, and `genres: [{{genres}}]` fills the brackets the user
 * wrote rather than nesting another list inside them.
 */
function emitYaml(
	value: TemplateValue | Raw,
	prevChar: string,
	nextChar: string,
): string {
	if (value instanceof Raw) return value.text;
	if (value === null || value === undefined) return "";

	const insideDouble = prevChar === '"' && nextChar === '"';
	const insideSingle = prevChar === "'" && nextChar === "'";
	const insideBrackets = prevChar === "[" && nextChar === "]";

	if (insideDouble) {
		const text = Array.isArray(value) ? value.join(", ") : String(value);
		return escapeInsideDoubleQuotes(text);
	}
	if (insideSingle) {
		const text = Array.isArray(value) ? value.join(", ") : String(value);
		return escapeInsideSingleQuotes(text);
	}
	if (insideBrackets) {
		// Emit the *contents* of a flow sequence, without its brackets.
		const items = Array.isArray(value) ? value.map(String) : [String(value)];
		return yamlFlowList(items).slice(1, -1);
	}

	if (Array.isArray(value)) return yamlFlowList(value.map(String));
	return yamlScalar(value as string | number | boolean);
}

function emitBody(value: TemplateValue | Raw): string {
	if (value instanceof Raw) return value.text;
	if (value === null || value === undefined) return "";
	if (Array.isArray(value)) return value.join(", ");
	return String(value);
}

/* ---------------------------------------------------------------- rendering */

interface Scope {
	vars: Record<string, TemplateValue>;
	/** Value of `.` inside an {{#each}} block. */
	item?: TemplateValue;
}

function lookup(expr: Expr, scope: Scope, missing: Set<string>): TemplateValue {
	if (expr.name === "." || expr.name === "this") return scope.item;
	if (!(expr.name in scope.vars)) {
		missing.add(expr.name);
		return undefined;
	}
	return scope.vars[expr.name];
}

function applyFilters(
	value: TemplateValue,
	filters: readonly FilterCall[],
	mode: RenderMode,
): TemplateValue | Raw {
	let current: TemplateValue | Raw = value;
	for (const call of filters) {
		const filter = FILTERS[call.name];
		if (!filter) throw new TemplateError(`Unknown filter: ${call.name}`);
		// A filter after a Raw operates on its text.
		const input = current instanceof Raw ? current.text : current;
		current = filter(input, call.args, { mode });
	}
	return current;
}

function renderNodes(
	nodes: readonly Node[],
	scope: Scope,
	mode: RenderMode,
	missing: Set<string>,
): string {
	let out = "";

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		if (!node) continue;

		switch (node.kind) {
			case "text":
				out += node.value;
				break;

			case "interp": {
				const raw = lookup(node.expr, scope, missing);
				const value = applyFilters(raw, node.expr.filters, mode);
				if (mode === "yaml") {
					const next = nodes[i + 1];
					const nextChar =
						next?.kind === "text" ? (next.value[0] ?? "") : "";
					out += emitYaml(value, out.slice(-1), nextChar);
				} else {
					out += emitBody(value);
				}
				break;
			}

			case "if": {
				const value = lookup(node.expr, scope, missing);
				const truthy = node.negate ? isEmpty(value) : !isEmpty(value);
				out += renderNodes(
					truthy ? node.then : node.otherwise,
					scope,
					mode,
					missing,
				);
				break;
			}

			case "each": {
				const value = lookup(node.expr, scope, missing);
				const items = Array.isArray(value) ? value : [];
				for (const item of items) {
					out += renderNodes(
						node.body,
						{ ...scope, item },
						mode,
						missing,
					);
				}
				break;
			}
		}
	}

	return out;
}

/** Splits leading `---` frontmatter from the body so each renders in its own mode. */
function splitFrontmatter(
	template: string,
): { frontmatter: string; body: string } | null {
	const match = /^---\r?\n([\s\S]*?\r?\n)---(\r?\n|$)/.exec(template);
	if (!match) return null;
	return {
		frontmatter: match[0],
		body: template.slice(match[0].length),
	};
}

/**
 * Renders a template against a flat placeholder map.
 *
 * Frontmatter is rendered in YAML mode (values escaped and lists emitted as
 * sequences); the body is rendered verbatim.
 */
export function renderTemplate(
	template: string,
	vars: Record<string, TemplateValue>,
): RenderResult {
	const missing = new Set<string>();
	const scope: Scope = { vars };
	const split = splitFrontmatter(template);

	const content = split
		? renderNodes(parse(split.frontmatter), scope, "yaml", missing) +
			renderNodes(parse(split.body), scope, "body", missing)
		: renderNodes(parse(template), scope, "body", missing);

	return { content, missing: [...missing] };
}
