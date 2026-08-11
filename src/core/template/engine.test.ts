import { describe, expect, it } from "vitest";
import { renderTemplate } from "./engine";
import { sanitizeFileName } from "../paths";

/** Parses the frontmatter block of a rendered note into key → raw value. */
function frontmatter(content: string): Record<string, string> {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
	if (!match?.[1]) throw new Error("no frontmatter found");
	const out: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const idx = line.indexOf(":");
		if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
	}
	return out;
}

describe("YAML safety in frontmatter", () => {
	it("escapes a double quote inside quotes the template already wrote", () => {
		const out = renderTemplate('---\ntitle: "{{title}}"\n---\n', {
			title: 'The "Burbs',
		});
		expect(frontmatter(out.content).title).toBe('"The \\"Burbs"');
		expect(out.content).not.toContain('"The "Burbs"');
	});

	it("quotes a bare value containing a colon", () => {
		const out = renderTemplate("---\ntitle: {{title}}\n---\n", {
			title: "Blade Runner: 2049",
		});
		expect(frontmatter(out.content).title).toBe('"Blade Runner: 2049"');
	});

	it("quotes values that would otherwise parse as numbers or booleans", () => {
		const out = renderTemplate("---\na: {{a}}\nb: {{b}}\n---\n", {
			a: "1984",
			b: "yes",
		});
		const fm = frontmatter(out.content);
		expect(fm.a).toBe('"1984"');
		expect(fm.b).toBe('"yes"');
	});

	it("quotes a leading @, which YAML reserves", () => {
		const out = renderTemplate("---\ntitle: {{title}}\n---\n", {
			title: "@midnight",
		});
		expect(frontmatter(out.content).title).toBe('"@midnight"');
	});

	it("renders a list as a flow sequence Dataview can query", () => {
		const out = renderTemplate("---\ngenres: {{tags}}\n---\n", {
			tags: ["Action", "Sci-Fi"],
		});
		// A hyphen mid-scalar is legal YAML, so neither item needs quoting.
		expect(frontmatter(out.content).genres).toBe("[Action, Sci-Fi]");
	});

	it("quotes a list item that starts with an indicator character", () => {
		const out = renderTemplate("---\ngenres: {{tags}}\n---\n", {
			tags: ["- weird", "fine"],
		});
		expect(frontmatter(out.content).genres).toBe('["- weird", fine]');
	});

	it("fills brackets the template already wrote, rather than nesting", () => {
		// This is the shape the existing bundled templates use.
		const out = renderTemplate("---\ngenres: [{{tags}}]\n---\n", {
			tags: ["Action", "Drama"],
		});
		expect(frontmatter(out.content).genres).toBe("[Action, Drama]");
	});

	it("quotes a list item containing a comma so the sequence stays intact", () => {
		const out = renderTemplate("---\ngenres: [{{tags}}]\n---\n", {
			tags: ["Action", "Crime, Mystery"],
		});
		expect(frontmatter(out.content).genres).toBe(
			'[Action, "Crime, Mystery"]',
		);
	});

	it("leaves the body unescaped", () => {
		const out = renderTemplate('---\ntitle: "{{title}}"\n---\n# {{title}}\n', {
			title: 'The "Burbs',
		});
		expect(out.content).toContain('# The "Burbs');
	});
});

describe("filters", () => {
	it("formats dates", () => {
		const out = renderTemplate("{{release_date|date:YYYY}}", {
			release_date: "1982-06-25",
		});
		expect(out.content).toBe("1982");
	});

	it("truncates long text", () => {
		const out = renderTemplate("{{description|truncate:10}}", {
			description: "A very long synopsis indeed",
		});
		expect(out.content).toBe("A very lon…");
	});

	it("rescales a rating onto a different range", () => {
		const out = renderTemplate("{{rating|scale:10:5}}", { rating: 8.4 });
		expect(out.content).toBe("4.2");
	});

	it("wikilinks list items inside frontmatter", () => {
		const out = renderTemplate("---\npeople: {{people|link}}\n---\n", {
			people: ["Ridley Scott"],
		});
		expect(frontmatter(out.content).people).toBe('["[[Ridley Scott]]"]');
	});

	it("substitutes a default for an empty value", () => {
		const out = renderTemplate("{{pages|default:Unknown}}", {
			pages: undefined,
		});
		expect(out.content).toBe("Unknown");
	});
});

describe("conditionals and loops", () => {
	it("omits a block when the value is empty", () => {
		const tpl = "{{#if runtime}}Runtime: {{runtime}}{{/if}}done";
		expect(renderTemplate(tpl, { runtime: undefined }).content).toBe("done");
		expect(renderTemplate(tpl, { runtime: 117 }).content).toBe(
			"Runtime: 117done",
		);
	});

	it("supports else", () => {
		const tpl = "{{#if isbn}}{{isbn}}{{else}}No ISBN{{/if}}";
		expect(renderTemplate(tpl, { isbn: "" }).content).toBe("No ISBN");
	});

	it("iterates a list", () => {
		const out = renderTemplate("{{#each people}}- {{.}}\n{{/each}}", {
			people: ["Ana", "Bo"],
		});
		expect(out.content).toBe("- Ana\n- Bo\n");
	});
});

describe("missing placeholders", () => {
	it("reports unknown names instead of leaving literal braces", () => {
		const out = renderTemplate("{{title}} {{nope}}", { title: "Alien" });
		expect(out.content).toBe("Alien ");
		expect(out.missing).toEqual(["nope"]);
	});

	it("does not report a known field that is merely empty", () => {
		const out = renderTemplate("{{overview}}", { overview: undefined });
		expect(out.missing).toEqual([]);
	});
});

describe("sanitizeFileName", () => {
	it("keeps spaces and hyphens", () => {
		expect(sanitizeFileName("Spider-Man - No Way Home")).toBe(
			"Spider-Man - No Way Home",
		);
	});

	it("turns a colon into a readable separator", () => {
		expect(sanitizeFileName("Blade Runner 2049: The Final Cut")).toBe(
			"Blade Runner 2049 - The Final Cut",
		);
	});

	it("strips characters that break wikilinks", () => {
		expect(sanitizeFileName("What? #1 [Draft] ^v2 <x>")).toBe(
			"What 1 Draft v2 x",
		);
	});

	it("falls back when nothing survives", () => {
		expect(sanitizeFileName("###")).toBe("Untitled");
		expect(sanitizeFileName("")).toBe("Untitled");
	});

	it("strips trailing dots and spaces that Windows rejects", () => {
		expect(sanitizeFileName("Movie Title...")).toBe("Movie Title");
	});

	it("escapes reserved Windows device names", () => {
		expect(sanitizeFileName("CON")).toBe("_CON");
	});

	it("truncates very long titles", () => {
		expect(sanitizeFileName("A".repeat(300)).length).toBeLessThanOrEqual(180);
	});
});
